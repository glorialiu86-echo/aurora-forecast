// aacgmv2_shim.c
// Minimal C shim to expose a stable WASM API for JS.
// It calls the AACGM-v2 C library bundled inside aburrell/aacgmv2.

#include <stdint.h>
#include <math.h>

// The aacgmv2 C library headers (from aburrell/aacgmv2) expose low-level conversions.
// In the python wrapper repo, the C sources are under aacgmv2/ (and include the AACGM-v2 core).
// We will include the needed header after we vendor the repo in the workflow.

#include "aacgmv2/aacgmv2.h"

// Return AACGMv2 magnetic latitude (degrees) for a geographic location/time.
double aacgmv2_mlat(double glat, double glon, double alt_km, int64_t ut_seconds) {
  double mlat = NAN, mlon = NAN, mlt = NAN;
  int ierr = 0;

  // aacgmv2_convert_latlon expects: lat, lon, alt(km), date/time (as year, month, day, etc.)
  // But the C core uses "datetime" helpers in wrapper; the simplest is to use the C wrapper
  // function that takes unix seconds if available.
  //
  // In aburrell/aacgmv2, the C-extension exposes functions; here we rely on the C API:
  // We'll convert unix seconds -> struct tm in UTC.

  time_t t = (time_t)ut_seconds;
  struct tm g;
#if defined(_WIN32)
  gmtime_s(&g, &t);
#else
  gmtime_r(&t, &g);
#endif

  int year = g.tm_year + 1900;
  int month = g.tm_mon + 1;
  int day = g.tm_mday;
  int hour = g.tm_hour;
  int minute = g.tm_min;
  int second = g.tm_sec;

  // This is the canonical entry in the C library:
  // aacgm_v2_convert(glat, glon, alt, &mlat, &mlon, year, month, day, hour, minute, second, &ierr)
  aacgm_v2_convert(glat, glon, alt_km, &mlat, &mlon, year, month, day, hour, minute, second, &ierr);

  if (ierr != 0) return NAN;
  return mlat;
}

double aacgmv2_mlon(double glat, double glon, double alt_km, int64_t ut_seconds) {
  double mlat = NAN, mlon = NAN;
  int ierr = 0;

  time_t t = (time_t)ut_seconds;
  struct tm g;
#if defined(_WIN32)
  gmtime_s(&g, &t);
#else
  gmtime_r(&t, &g);
#endif

  int year = g.tm_year + 1900;
  int month = g.tm_mon + 1;
  int day = g.tm_mday;
  int hour = g.tm_hour;
  int minute = g.tm_min;
  int second = g.tm_sec;

  aacgm_v2_convert(glat, glon, alt_km, &mlat, &mlon, year, month, day, hour, minute, second, &ierr);
  if (ierr != 0) return NAN;
  return mlon;
}
