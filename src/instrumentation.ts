export async function register() {
  // Node modülleri edge paketine girmesin diye yalnız nodejs çalışma ortamında yükleniyor.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { scheduleMediaSweep } = await import("./lib/media");
    scheduleMediaSweep();
  }
}
