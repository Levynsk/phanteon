#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <ksmedia.h>
#include <wrl/client.h>
#include <cstdint>
#include <cstdio>
#include <cwchar>
#include <fcntl.h>
#include <io.h>

using Microsoft::WRL::ComPtr;

static volatile LONG stopping = 0;

static BOOL WINAPI console_handler(DWORD signal) {
  if (signal == CTRL_C_EVENT || signal == CTRL_BREAK_EVENT || signal == CTRL_CLOSE_EVENT || signal == CTRL_SHUTDOWN_EVENT) {
    InterlockedExchange(&stopping, 1);
    return TRUE;
  }
  return FALSE;
}

static void report_error(const char* message, HRESULT hr) {
  std::fprintf(stderr, "%s: 0x%08lx\n", message, static_cast<unsigned long>(hr));
}

static int probe() {
  const HRESULT init_hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(init_hr)) {
    report_error("COM initialization failed", init_hr);
    return 10;
  }

  ComPtr<IMMDeviceEnumerator> enumerator;
  ComPtr<IMMDevice> device;
  ComPtr<IAudioClient> client;
  WAVEFORMATEX* mix_format = nullptr;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (SUCCEEDED(hr)) hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
  if (SUCCEEDED(hr)) hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(client.GetAddressOf()));
  if (SUCCEEDED(hr)) hr = client->GetMixFormat(&mix_format);
  WAVEFORMATEX requested_format = {};
  requested_format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
  requested_format.nChannels = 2;
  requested_format.nSamplesPerSec = 48000;
  requested_format.wBitsPerSample = 32;
  requested_format.nBlockAlign = 2 * sizeof(float);
  requested_format.nAvgBytesPerSec = requested_format.nSamplesPerSec * requested_format.nBlockAlign;
  if (SUCCEEDED(hr)) {
    WAVEFORMATEX* closest_match = nullptr;
    hr = client->IsFormatSupported(AUDCLNT_SHAREMODE_SHARED, &requested_format, &closest_match);
    if (closest_match) CoTaskMemFree(closest_match);
    if (hr == S_FALSE) hr = AUDCLNT_E_UNSUPPORTED_FORMAT;
  }
  if (SUCCEEDED(hr)) hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 10000000, 0, &requested_format, nullptr);
  if (FAILED(hr)) report_error("WASAPI 48 kHz loopback unavailable", hr);
  else std::puts("{}");
  if (mix_format) CoTaskMemFree(mix_format);

  CoUninitialize();
  return FAILED(hr) ? 11 : 0;
}

static int capture() {
  const HRESULT init_hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(init_hr)) {
    report_error("COM initialization failed", init_hr);
    return 10;
  }

  int result = 0;
  HRESULT hr = S_OK;
  WAVEFORMATEX* mix_format = nullptr;
  HANDLE audio_event = nullptr;
  bool started = false;
  ComPtr<IMMDeviceEnumerator> enumerator;
  ComPtr<IMMDevice> device;
  ComPtr<IAudioClient> client;
  ComPtr<IAudioCaptureClient> capture_client;

  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (SUCCEEDED(hr)) hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
  if (SUCCEEDED(hr)) hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(client.GetAddressOf()));
  if (SUCCEEDED(hr)) hr = client->GetMixFormat(&mix_format);
  if (FAILED(hr)) {
    report_error("WASAPI default output unavailable", hr);
    result = 11;
    goto cleanup;
  }

  {
    WAVEFORMATEX requested_format = {};
    requested_format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
    requested_format.nChannels = 2;
    requested_format.nSamplesPerSec = 48000;
    requested_format.wBitsPerSample = 32;
    requested_format.nBlockAlign = static_cast<WORD>(requested_format.nChannels * sizeof(float));
    requested_format.nAvgBytesPerSec = requested_format.nSamplesPerSec * requested_format.nBlockAlign;

    WAVEFORMATEX* closest_match = nullptr;
    hr = client->IsFormatSupported(AUDCLNT_SHAREMODE_SHARED, &requested_format, &closest_match);
    if (closest_match) CoTaskMemFree(closest_match);
    if (hr == S_FALSE) {
      std::fprintf(stderr, "WASAPI shared mode does not support 48 kHz stereo float32 (mix format: %u Hz, %u channels).\n",
                   mix_format->nSamplesPerSec, mix_format->nChannels);
      result = 12;
      goto cleanup;
    }
    if (FAILED(hr)) {
      report_error("WASAPI format check failed", hr);
      result = 12;
      goto cleanup;
    }

    audio_event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!audio_event) {
      report_error("WASAPI event creation failed", HRESULT_FROM_WIN32(GetLastError()));
      result = 13;
      goto cleanup;
    }
    hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                            AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                            0, 0, &requested_format, nullptr);
    if (FAILED(hr)) {
      report_error("WASAPI loopback initialization failed", hr);
      result = 14;
      goto cleanup;
    }
  }

  hr = client->SetEventHandle(audio_event);
  if (SUCCEEDED(hr)) hr = client->GetService(IID_PPV_ARGS(&capture_client));
  if (FAILED(hr)) {
    report_error("WASAPI capture service initialization failed", hr);
    result = 15;
    goto cleanup;
  }

  SetConsoleCtrlHandler(console_handler, TRUE);
  hr = client->Start();
  if (FAILED(hr)) {
    report_error("WASAPI start failed", hr);
    result = 16;
    goto cleanup;
  }
  started = true;

  while (InterlockedCompareExchange(&stopping, 0, 0) == 0) {
    const DWORD wait_result = WaitForSingleObject(audio_event, 100);
    if (wait_result == WAIT_TIMEOUT) continue;
    if (wait_result != WAIT_OBJECT_0) {
      report_error("WASAPI event wait failed", HRESULT_FROM_WIN32(GetLastError()));
      result = 17;
      break;
    }

    UINT32 packet_frames = 0;
    hr = capture_client->GetNextPacketSize(&packet_frames);
    if (FAILED(hr)) {
      report_error("WASAPI packet query failed", hr);
      result = 18;
      break;
    }

    while (packet_frames > 0) {
      BYTE* data = nullptr;
      DWORD flags = 0;
      hr = capture_client->GetBuffer(&data, &packet_frames, &flags, nullptr, nullptr);
      if (FAILED(hr)) {
        report_error("WASAPI buffer acquisition failed", hr);
        result = 19;
        break;
      }

      bool write_ok = true;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        static const float silence[480 * 2] = {};
        UINT32 remaining = packet_frames;
        while (remaining > 0) {
          const UINT32 frames = remaining < 480 ? remaining : 480;
          if (std::fwrite(silence, sizeof(float) * 2, frames, stdout) != frames) {
            write_ok = false;
            break;
          }
          remaining -= frames;
        }
      } else if (!data || std::fwrite(data, sizeof(float) * 2, packet_frames, stdout) != packet_frames) {
        write_ok = false;
      }

      const HRESULT release_hr = capture_client->ReleaseBuffer(packet_frames);
      if (!write_ok) {
        result = 20;
        InterlockedExchange(&stopping, 1);
      } else if (FAILED(release_hr)) {
        report_error("WASAPI buffer release failed", release_hr);
        result = 21;
      }
      if (!write_ok || FAILED(release_hr)) break;

      hr = capture_client->GetNextPacketSize(&packet_frames);
      if (FAILED(hr)) {
        report_error("WASAPI packet query failed", hr);
        result = 18;
        break;
      }
    }
    if (result != 0) break;
    if (std::fflush(stdout) != 0) {
      std::fprintf(stderr, "Failed to flush captured audio to stdout.\n");
      result = 20;
      break;
    }
  }

cleanup:
  if (started) {
    const HRESULT stop_hr = client->Stop();
    if (FAILED(stop_hr) && result == 0) {
      report_error("WASAPI stop failed", stop_hr);
      result = 22;
    }
  }
  if (mix_format) CoTaskMemFree(mix_format);
  if (audio_event) CloseHandle(audio_event);
  SetConsoleCtrlHandler(console_handler, FALSE);
  CoUninitialize();
  return result;
}

int wmain(int argc, wchar_t** argv) {
  if (_setmode(_fileno(stdout), _O_BINARY) == -1) return 23;
  if (argc != 2 || wcscmp(argv[1], L"--help") == 0) {
    std::fwprintf(stderr, L"usage: wasapi-capture probe | capture-desktop\n");
    return argc == 2 ? 0 : 2;
  }
  if (wcscmp(argv[1], L"probe") == 0) return probe();
  if (wcscmp(argv[1], L"capture-desktop") == 0) return capture();
  std::fwprintf(stderr, L"unknown command\n");
  return 2;
}
