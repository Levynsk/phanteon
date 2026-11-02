#define _GNU_SOURCE
#include <pulse/pulseaudio.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <stdint.h>
#include <stdbool.h>
#include <strings.h>

#define MAX_STREAMS 512
#define MAX_TEXT 256

typedef struct { uint32_t index, sink, module_id; pid_t pid; char name[MAX_TEXT]; char binary[MAX_TEXT]; } Stream;
static Stream streams[MAX_STREAMS];
static unsigned stream_count;
static Stream initial_streams[MAX_STREAMS];
static unsigned initial_stream_count;
static pa_threaded_mainloop *loop;
static pa_context *ctx;
static int done;
static int loop_started;
static const char *prop(const pa_proplist *p, const char *key);
static int is_phanteon(const Stream *s);
static int selected_stream(const Stream *s, const char *mode, uint32_t pid, const char *app_name);
static void wait_done(void);
static volatile sig_atomic_t failed;
static volatile sig_atomic_t capture_changed;
static volatile sig_atomic_t stopping;
static uint32_t module_null = PA_INVALID_INDEX;
static uint32_t return_modules[MAX_STREAMS];
static unsigned return_count;
static uint32_t original_sink = PA_INVALID_INDEX;
static uint32_t moved[MAX_STREAMS];
static uint32_t moved_to[MAX_STREAMS];
static uint32_t restore_sink[MAX_STREAMS];
static pid_t moved_pid[MAX_STREAMS];
static char moved_name[MAX_STREAMS][MAX_TEXT];
static unsigned moved_count;
static uint32_t helper_return_streams[MAX_STREAMS];
static unsigned helper_return_count;
static uint32_t null_sink_index = PA_INVALID_INDEX;
static char capture_source[128];
static pa_stream *capture_stream;
static int capture_active;
static const char *capture_mode;
static uint32_t capture_pid;
static const char *capture_app_name;

static void on_signal(int sig) { (void)sig; stopping = 1; }
static void subscription_info_cb(pa_context *c, const pa_sink_input_info *i, int eol, void *ud);
static void subscription_cb(pa_context *c, pa_subscription_event_type_t type, uint32_t index, void *ud);
static void wait_done(void) { while (!done && !failed) pa_threaded_mainloop_wait(loop); }
static const char *prop(const pa_proplist *p, const char *key) { const char *s = pa_proplist_gets(p, key); return s ? s : ""; }
static void info_cb(pa_context *c, const pa_sink_input_info *i, int eol, void *ud) {
  (void)c; (void)ud;
  if (eol) { done = 1; pa_threaded_mainloop_signal(loop, 0); return; }
  if (!i) return;
  if (stream_count >= MAX_STREAMS) { failed = 1; return; }
  Stream *s = &streams[stream_count++];
  s->index = i->index; s->sink = i->sink;
  s->module_id = i->owner_module;
  s->pid = (pid_t)strtol(prop(i->proplist, PA_PROP_APPLICATION_PROCESS_ID), NULL, 10);
  snprintf(s->name, sizeof(s->name), "%s", prop(i->proplist, PA_PROP_APPLICATION_NAME));
  snprintf(s->binary, sizeof(s->binary), "%s", prop(i->proplist, PA_PROP_APPLICATION_PROCESS_BINARY));
}
static int list_streams(void) {
  stream_count = 0; done = failed = 0;
  pa_operation *op = pa_context_get_sink_input_info_list(ctx, info_cb, NULL);
  if (!op) return -1;
  wait_done(); pa_operation_unref(op);
  return failed ? -1 : 0;
}
static int is_helper_return_stream(const Stream *s) {
  if (s->pid == getpid()) return 1;
  for (unsigned n=0; n<return_count; n++) if (s->module_id == return_modules[n]) return 1;
  for (unsigned n=0; n<helper_return_count; n++) if (helper_return_streams[n] == s->index) return 1;
  return 0;
}
static int is_expected_selected_stream(const Stream *s) {
  for (unsigned n=0; n<moved_count; n++) {
    if (s->pid == moved_pid[n] && strcmp(s->name,moved_name[n]) == 0 && s->sink == null_sink_index) return 1;
  }
  return 0;
}
static void subscription_info_cb(pa_context *c, const pa_sink_input_info *i, int eol, void *ud) {
  (void)c;
  uint32_t index = *(uint32_t*)ud;
  if (eol) {
    if (stream_count != 1 || streams[0].index != index ||
        (!is_helper_return_stream(&streams[0]) && !is_expected_selected_stream(&streams[0]))) capture_changed = 1;
    done = 1;
    pa_threaded_mainloop_signal(loop, 0);
    return;
  }
  if (!i || i->index != index) { capture_changed = 1; return; }
  if (stream_count < MAX_STREAMS) {
    Stream *s = &streams[stream_count++];
    s->index = i->index; s->sink = i->sink;
    s->module_id = i->owner_module;
    s->pid = (pid_t)strtol(prop(i->proplist, PA_PROP_APPLICATION_PROCESS_ID), NULL, 10);
    snprintf(s->name, sizeof(s->name), "%s", prop(i->proplist, PA_PROP_APPLICATION_NAME));
    snprintf(s->binary, sizeof(s->binary), "%s", prop(i->proplist, PA_PROP_APPLICATION_PROCESS_BINARY));
  }
}
static void subscription_cb(pa_context *c, pa_subscription_event_type_t type, uint32_t index, void *ud) {
  (void)ud;
  pa_subscription_event_type_t facility = type & PA_SUBSCRIPTION_EVENT_FACILITY_MASK;
  pa_subscription_event_type_t event = type & PA_SUBSCRIPTION_EVENT_TYPE_MASK;
  if (!capture_active || facility != PA_SUBSCRIPTION_EVENT_SINK_INPUT) return;
  if (event == PA_SUBSCRIPTION_EVENT_REMOVE) {
    bool expected = false;
    for (unsigned n=0; n<initial_stream_count; n++) {
      if (initial_streams[n].index == index && selected_stream(&initial_streams[n], capture_mode, capture_pid, capture_app_name)) expected = true;
    }
    for (unsigned n=0; n<moved_count; n++) if (moved[n] == index) expected = true;
    for (unsigned n=0; n<helper_return_count; n++) if (helper_return_streams[n] == index) expected = true;
    if (!expected) capture_changed = 1;
    pa_threaded_mainloop_signal(loop, 0);
  } else if (event == PA_SUBSCRIPTION_EVENT_NEW) {
    done = failed = stream_count = 0;
    pa_operation *op = pa_context_get_sink_input_info(c, index, subscription_info_cb, &index);
    if (!op) capture_changed = 1;
    else { wait_done(); pa_operation_unref(op); }
    pa_threaded_mainloop_signal(loop, 0);
  }
}
static void success_cb(pa_context *c, int success, void *ud) { (void)c; (void)ud; if (!success) failed = 1; done = 1; pa_threaded_mainloop_signal(loop, 0); }
static void index_cb(pa_context *c, uint32_t index, void *ud) { (void)c; uint32_t *out = ud; *out = index; done = 1; pa_threaded_mainloop_signal(loop, 0); }
static int wait_op(pa_operation *op) { if (!op) return -1; wait_done(); pa_operation_unref(op); return failed ? -1 : 0; }
static uint32_t load_module(const char *name, const char *args) {
  done = failed = 0; uint32_t index = PA_INVALID_INDEX;
  if (wait_op(pa_context_load_module(ctx, name, args, index_cb, &index)) < 0) return PA_INVALID_INDEX;
  return index;
}
static int unload_module(uint32_t index) {
  if (index == PA_INVALID_INDEX) return 0;
  done = failed = 0;
  return wait_op(pa_context_unload_module(ctx, index, success_cb, NULL));
}
static int move_stream(uint32_t index, uint32_t sink) {
  done = failed = 0;
  return wait_op(pa_context_move_sink_input_by_index(ctx, index, sink, success_cb, NULL));
}
static void state_cb(pa_context *c, void *ud) { (void)ud; pa_context_state_t s = pa_context_get_state(c); if (s == PA_CONTEXT_READY || s == PA_CONTEXT_FAILED || s == PA_CONTEXT_TERMINATED) { done = 1; if (s != PA_CONTEXT_READY) failed = 1; pa_threaded_mainloop_signal(loop, 0); } }
static void sink_cb(pa_context *c, const pa_sink_info *i, int eol, void *ud) { (void)c; if (eol) { done=1; pa_threaded_mainloop_signal(loop,0); return; } if (i && strcmp(i->name, (const char*)ud)==0) null_sink_index=i->index; }
static char default_sink_name[128];
static void server_info_cb(pa_context *c, const pa_server_info *i, void *ud) { (void)c; (void)ud; if (i && i->default_sink_name) snprintf(default_sink_name,sizeof(default_sink_name),"%s",i->default_sink_name); done=1; pa_threaded_mainloop_signal(loop,0); }
static void default_sink_cb(pa_context *c, const pa_sink_info *i, int eol, void *ud) { (void)c; (void)ud; if (eol) { done=1; pa_threaded_mainloop_signal(loop,0); return; } if (i) original_sink=i->index; }
static void stream_state_cb(pa_stream *s, void *ud) { (void)ud; pa_stream_state_t st=pa_stream_get_state(s); if (st==PA_STREAM_READY || st==PA_STREAM_FAILED || st==PA_STREAM_TERMINATED) { done=1; if(st!=PA_STREAM_READY) failed=1; pa_threaded_mainloop_signal(loop,0); } }
static void read_cb(pa_stream *s, size_t nbytes, void *ud) {
  (void)ud;
  const void *data = NULL;
  if (pa_stream_peek(s, &data, &nbytes) < 0) { stopping = 1; return; }
  int write_failed = 0;
  if (data && nbytes) write_failed = fwrite(data, 1, nbytes, stdout) != nbytes;
  else {
    static const uint8_t silence[4096] = {0};
    size_t left = nbytes;
    while (left) {
      size_t n = left > sizeof(silence) ? sizeof(silence) : left;
      if (fwrite(silence, 1, n, stdout) != n) { write_failed = 1; break; }
      left -= n;
    }
  }
  if (pa_stream_drop(s) < 0) stopping = 1;
  if (fflush(stdout) != 0 || write_failed) stopping = 1;
}
static int connect_pulse(void) {
  loop = pa_threaded_mainloop_new(); if (!loop) return -1;
  pa_mainloop_api *api = pa_threaded_mainloop_get_api(loop);
  ctx = pa_context_new(api, "Phanteon audio capture");
  if (!ctx || pa_context_connect(ctx, NULL, PA_CONTEXT_NOFLAGS, NULL) < 0) return -1;
  if (pa_threaded_mainloop_start(loop) < 0) return -1;
  loop_started = 1;
  pa_threaded_mainloop_lock(loop); done = failed = 0; pa_context_set_state_callback(ctx, state_cb, NULL); wait_done(); pa_threaded_mainloop_unlock(loop);
  return failed ? -1 : 0;
}
static void disconnect_pulse(void) {
  if (!loop) return;
  if (loop_started) pa_threaded_mainloop_lock(loop);
  if (ctx) { pa_context_disconnect(ctx); pa_context_unref(ctx); ctx = NULL; }
  if (loop_started) pa_threaded_mainloop_unlock(loop);
  if (loop_started) pa_threaded_mainloop_stop(loop);
  pa_threaded_mainloop_free(loop); loop = NULL; loop_started = 0;
}
static int is_phanteon(const Stream *s) {
  return strcasestr(s->name, "phanteon") || strcasestr(s->binary, "phanteon");
}
static int selected_stream(const Stream *s, const char *mode, uint32_t pid, const char *app_name) {
  if (strcmp(mode, "app") != 0) return !is_phanteon(s);
  return app_name && s->pid == (pid_t)pid && strcmp(s->name, app_name) == 0;
}
static void print_list(void) {
  puts("[" );
  for (unsigned i=0; i<stream_count; i++) {
    Stream *s=&streams[i];
    printf("%s{\"index\":%u,\"sink\":%u,\"pid\":%d,\"name\":\"", i ? "," : "", s->index, s->sink, (int)s->pid);
    for (const unsigned char *p=(const unsigned char*)s->name; *p; p++) { if (*p=='\\' || *p=='\"') putchar('\\'); if (*p>=32) putchar(*p); }
    printf("\",\"binary\":\"");
    for (const unsigned char *p=(const unsigned char*)s->binary; *p; p++) { if (*p=='\\' || *p=='\"') putchar('\\'); if (*p>=32) putchar(*p); }
    printf("\"}");
  }
  puts("\n]");
}
static void cleanup_locked(void) {
  if (!ctx) return;
  capture_active = 0;
  for (unsigned n=0; n<moved_count; n++) {
    stream_count=0; done=failed=0;
    pa_operation *op=pa_context_get_sink_input_info(ctx, moved[n], info_cb, NULL);
    if (op) { wait_done(); pa_operation_unref(op); }
    bool original_match = false;
    if (stream_count && streams[0].pid == moved_pid[n] && strcmp(streams[0].name, moved_name[n]) == 0) {
      for (unsigned j=0; j<initial_stream_count; j++) {
        if (initial_streams[j].pid == moved_pid[n] && strcmp(initial_streams[j].name, moved_name[n]) == 0 &&
            initial_streams[j].sink == restore_sink[n]) original_match = true;
      }
    }
    if (stream_count && streams[0].sink == moved_to[n] && original_match) (void)move_stream(moved[n], restore_sink[n]);
  }
  for (unsigned n=0; n<return_count; n++) (void)unload_module(return_modules[n]);
  (void)unload_module(module_null);
  return_count=0; module_null=PA_INVALID_INDEX;
  moved_count=0;
}
static int capture(const char *mode, uint32_t pid, const char *app_name) {
  signal(SIGINT, on_signal); signal(SIGTERM, on_signal); signal(SIGPIPE, SIG_IGN);
  capture_mode = mode; capture_pid = pid; capture_app_name = app_name;
  pa_threaded_mainloop_lock(loop);
  if (list_streams() < 0) { pa_threaded_mainloop_unlock(loop); return 2; }
  initial_stream_count = stream_count;
  memcpy(initial_streams, streams, stream_count * sizeof(Stream));
  if (strcmp(mode, "app") == 0) {
    for (unsigned i=0; i<stream_count; i++) {
      int match = pid ? streams[i].pid == (pid_t)pid && app_name && strcmp(streams[i].name, app_name) == 0
                      : app_name && strcmp(streams[i].name, app_name) == 0;
      if (!match) continue;
      if (is_phanteon(&streams[i])) { pa_threaded_mainloop_unlock(loop); fprintf(stderr,"refusing Phanteon stream\n"); return 3; }
      if (original_sink == PA_INVALID_INDEX) original_sink = streams[i].sink;
      else if (original_sink != streams[i].sink) { pa_threaded_mainloop_unlock(loop); fprintf(stderr,"selected app streams span multiple output sinks\n"); return 4; }
    }
    if (original_sink == PA_INVALID_INDEX) { pa_threaded_mainloop_unlock(loop); fprintf(stderr,"selected app stream not found\n"); return 4; }
  } else {
    original_sink=PA_INVALID_INDEX;
    done=failed=0;
    default_sink_name[0]=0; pa_operation *server=pa_context_get_server_info(ctx,server_info_cb,NULL);
    if (!server || wait_op(server)<0 || !default_sink_name[0]) { pa_threaded_mainloop_unlock(loop); fprintf(stderr,"could not resolve default output sink\n"); return 4; }
    done=failed=0; pa_operation *sink=pa_context_get_sink_info_by_name(ctx,default_sink_name,default_sink_cb,NULL);
    if (!sink || wait_op(sink)<0 || original_sink==PA_INVALID_INDEX) { pa_threaded_mainloop_unlock(loop); fprintf(stderr,"could not resolve default output index\n"); return 4; }
  }
  char args[256]; snprintf(args,sizeof(args),"sink_name=phanteon_capture_%ld sink_properties=device.description=PhanteonCapture",(long)getpid());
  module_null=load_module("module-null-sink",args);
  if (module_null==PA_INVALID_INDEX) { pa_threaded_mainloop_unlock(loop); fprintf(stderr,"could not create capture sink\n"); return 5; }
  char sink_name[96], monitor[112]; snprintf(sink_name,sizeof(sink_name),"phanteon_capture_%ld",(long)getpid()); snprintf(monitor,sizeof(monitor),"%s.monitor",sink_name);
  done=failed=0; null_sink_index=PA_INVALID_INDEX;
  pa_operation *sink_op=pa_context_get_sink_info_list(ctx,sink_cb,sink_name); if (!sink_op) failed=1; else { wait_done(); pa_operation_unref(sink_op); }
  if (null_sink_index==PA_INVALID_INDEX || failed) {
    cleanup_locked(); pa_threaded_mainloop_unlock(loop); fprintf(stderr,"created sink could not be resolved\n"); return 5;
  }
  uint32_t null_sink=null_sink_index;
  snprintf(capture_source,sizeof(capture_source),"%s",monitor);
  unsigned eligible = 0;
  uint32_t return_sink = PA_INVALID_INDEX;
  for (unsigned i=0; i<stream_count; i++) {
    if (!selected_stream(&streams[i], mode, pid, app_name)) continue;
    if (return_sink == PA_INVALID_INDEX) return_sink = streams[i].sink;
    else if (return_sink != streams[i].sink) {
      cleanup_locked(); pa_threaded_mainloop_unlock(loop);
      fprintf(stderr,"selected streams span multiple output sinks; refusing unsafe return routing\n"); return 6;
    }
    eligible++;
  }
  if (!eligible || eligible > MAX_STREAMS) {
    cleanup_locked(); pa_threaded_mainloop_unlock(loop); fprintf(stderr,"no eligible audio streams or stream limit exceeded\n"); return 6;
  }
  for (unsigned i=0; i<stream_count; i++) {
    if (!selected_stream(&streams[i], mode, pid, app_name)) continue;
    moved[moved_count]=streams[i].index; moved_to[moved_count]=null_sink; restore_sink[moved_count]=streams[i].sink;
    moved_pid[moved_count]=streams[i].pid; snprintf(moved_name[moved_count],MAX_TEXT,"%s",streams[i].name); moved_count++;
    if (move_stream(streams[i].index, null_sink)<0) { failed=1; break; }
  }
  if (failed || moved_count != eligible) {
    cleanup_locked(); pa_threaded_mainloop_unlock(loop); fprintf(stderr,"routing changed during capture setup; rolled back\n"); return 6;
  }
  stream_count = 0;
  if (list_streams() < 0) {
    cleanup_locked(); pa_threaded_mainloop_unlock(loop); fprintf(stderr,"could not verify moved streams; rolled back\n"); return 6;
  }
  unsigned resolved = 0;
  for (unsigned i=0; i<stream_count; i++) {
    if (!selected_stream(&streams[i], mode, pid, app_name) || streams[i].sink != null_sink) continue;
    bool initial_match = false;
    for (unsigned j=0; j<initial_stream_count; j++) {
      if (selected_stream(&initial_streams[j], mode, pid, app_name) && initial_streams[j].sink == return_sink) initial_match = true;
    }
    if (!initial_match || resolved >= eligible) {
      cleanup_locked(); pa_threaded_mainloop_unlock(loop); fprintf(stderr,"unrelated stream appeared on capture sink; rolled back\n"); return 6;
    }
    bool duplicate = false;
    for (unsigned n=0; n<resolved; n++) if (moved[n] == streams[i].index) duplicate = true;
    if (duplicate) continue;
    moved[resolved]=streams[i].index; moved_to[resolved]=null_sink; restore_sink[resolved]=return_sink;
    moved_pid[resolved]=streams[i].pid; snprintf(moved_name[resolved],MAX_TEXT,"%s",streams[i].name); resolved++;
  }
  if (resolved != eligible) {
    cleanup_locked(); pa_threaded_mainloop_unlock(loop); fprintf(stderr,"selected streams could not be resolved after move; rolled back\n"); return 6;
  }
  moved_count = resolved;
  for (unsigned n=0; n<moved_count; n++) {
    bool already_returned=false;
    for (unsigned j=0; j<n; j++) if (restore_sink[j]==restore_sink[n]) already_returned=true;
    if (already_returned) continue;
    char retargs[256]; snprintf(retargs,sizeof(retargs),"source=%s sink=%u latency_msec=50",monitor,restore_sink[n]);
    return_modules[return_count]=load_module("module-loopback",retargs);
    if (return_modules[return_count]==PA_INVALID_INDEX) { cleanup_locked(); pa_threaded_mainloop_unlock(loop); fprintf(stderr,"could not create playback return route\n"); return 7; }
    return_count++;
  }
  stream_count = 0;
  if (list_streams() < 0) failed = 1;
  for (unsigned n=0; n<moved_count; n++) {
    bool found = false;
    for (unsigned i=0; i<stream_count; i++) {
      if (streams[i].pid == moved_pid[n] && strcmp(streams[i].name,moved_name[n]) == 0 && streams[i].sink == null_sink) found = true;
    }
    if (!found) failed = 1;
  }
  for (unsigned i=0; i<stream_count; i++) {
    bool expected = false;
    for (unsigned n=0; n<moved_count; n++) {
      if (streams[i].pid == moved_pid[n] && strcmp(streams[i].name,moved_name[n]) == 0 && streams[i].sink == null_sink) expected = true;
    }
    if (expected) continue;
    bool existed = false;
    for (unsigned j=0; j<initial_stream_count; j++) if (streams[i].index == initial_streams[j].index) existed = true;
    if (!existed && is_helper_return_stream(&streams[i]) && helper_return_count < MAX_STREAMS) helper_return_streams[helper_return_count++] = streams[i].index;
    else if (!existed) failed = 1;
  }
  if (failed) { cleanup_locked(); pa_threaded_mainloop_unlock(loop); fprintf(stderr,"stream set changed during capture setup; rolled back\n"); return 6; }
  capture_active = 1;
  capture_changed = 0;
  pa_context_set_subscribe_callback(ctx, subscription_cb, NULL);
  done=failed=0;
  if (wait_op(pa_context_subscribe(ctx, PA_SUBSCRIPTION_MASK_SINK_INPUT, success_cb, NULL)) < 0) {
    cleanup_locked(); pa_threaded_mainloop_unlock(loop); fprintf(stderr,"could not monitor stream changes\n"); return 6;
  }
  stream_count = 0;
  if (list_streams() < 0 || capture_changed) failed = 1;
  unsigned post_subscribe_selected = 0;
  for (unsigned i=0; i<stream_count; i++) {
    if (!selected_stream(&streams[i], mode, pid, app_name) || streams[i].sink != null_sink) continue;
    bool initial_identity = false;
    for (unsigned n=0; n<moved_count; n++) {
      if (streams[i].pid == moved_pid[n] && strcmp(streams[i].name,moved_name[n]) == 0) initial_identity = true;
    }
    if (!initial_identity || post_subscribe_selected >= moved_count) { failed = 1; continue; }
    moved[post_subscribe_selected] = streams[i].index;
    moved_to[post_subscribe_selected] = null_sink;
    restore_sink[post_subscribe_selected] = original_sink;
    moved_pid[post_subscribe_selected] = streams[i].pid;
    snprintf(moved_name[post_subscribe_selected],MAX_TEXT,"%s",streams[i].name);
    post_subscribe_selected++;
  }
  if (post_subscribe_selected != moved_count) failed = 1;
  for (unsigned j=0; j<initial_stream_count; j++) {
    if (selected_stream(&initial_streams[j], mode, pid, app_name)) continue;
    bool found = false;
    for (unsigned i=0; i<stream_count; i++) if (streams[i].index == initial_streams[j].index) found = true;
    if (!found) failed = 1;
  }
  for (unsigned i=0; i<stream_count; i++) {
    bool tracked = false;
    for (unsigned n=0; n<moved_count; n++) {
      if (streams[i].pid == moved_pid[n] && strcmp(streams[i].name,moved_name[n]) == 0 && streams[i].sink == null_sink) tracked = true;
    }
    if (is_helper_return_stream(&streams[i])) {
      if (!tracked && helper_return_count < MAX_STREAMS) helper_return_streams[helper_return_count++] = streams[i].index;
      tracked = true;
    }
    if (!tracked) {
      bool existed = false;
      for (unsigned j=0; j<initial_stream_count; j++) if (streams[i].index == initial_streams[j].index) existed = true;
      if (!existed) failed = 1;
    }
  }
  if (failed) {
    cleanup_locked(); pa_threaded_mainloop_unlock(loop); fprintf(stderr,"stream set changed during capture setup; rolled back\n"); return 6;
  }
  pa_sample_spec spec={.format=PA_SAMPLE_FLOAT32LE,.rate=48000,.channels=2};
  capture_stream=pa_stream_new(ctx,"Phanteon audio capture",&spec,NULL);
  if (!capture_stream) { cleanup_locked(); pa_threaded_mainloop_unlock(loop); return 8; }
  pa_stream_set_read_callback(capture_stream,read_cb,NULL);
  done=failed=0;
  if (pa_stream_connect_record(capture_stream,capture_source,&(pa_buffer_attr){.maxlength=262144,.fragsize=4096,.tlength=(uint32_t)-1,.prebuf=(uint32_t)-1,.minreq=(uint32_t)-1},PA_STREAM_ADJUST_LATENCY)<0) failed=1;
  else { pa_stream_set_state_callback(capture_stream,stream_state_cb,NULL); wait_done(); }
  if (failed) {
    if (capture_stream) { pa_stream_disconnect(capture_stream); pa_stream_unref(capture_stream); capture_stream=NULL; }
    cleanup_locked(); pa_threaded_mainloop_unlock(loop); fprintf(stderr,"could not connect to capture monitor\n"); return 8;
  }
  pa_threaded_mainloop_unlock(loop);
  while (!stopping && !failed && !capture_changed) usleep(10000);
  pa_threaded_mainloop_lock(loop);
  if (capture_stream) { pa_stream_disconnect(capture_stream); pa_stream_unref(capture_stream); capture_stream=NULL; }
  cleanup_locked();
  pa_threaded_mainloop_unlock(loop);
  return stopping ? 0 : 9;
}
int main(int argc, char **argv) {
  if (argc<2 || strcmp(argv[1],"--help")==0) { fprintf(stderr,"usage: pulse-capture list | capture-app PID APP_NAME | capture-desktop\n"); return argc<2 ? 2 : 0; }
  if (strcmp(argv[1],"list")!=0 && strcmp(argv[1],"capture-desktop")!=0 && !(strcmp(argv[1],"capture-app")==0 && argc>=4)) return 2;
  if (connect_pulse()<0) { fprintf(stderr,"local PulseAudio/PipeWire-Pulse unavailable\n"); disconnect_pulse(); return 10; }
  int result=0;
  pa_threaded_mainloop_lock(loop);
  if (strcmp(argv[1],"list")==0) { if (list_streams()<0) result=11; else print_list(); pa_threaded_mainloop_unlock(loop); }
  else { pa_threaded_mainloop_unlock(loop); if (strcmp(argv[1],"capture-app")==0 && argc>=4) result=capture("app",(uint32_t)strtoul(argv[2],NULL,10),argv[3]); else if (strcmp(argv[1],"capture-desktop")==0) result=capture("desktop",0,NULL); else result=2; }
  disconnect_pulse(); return result;
}
