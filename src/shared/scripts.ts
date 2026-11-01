/** The custom uni platform script name, used as `uni -p desktop`. */
export const DESKTOP_SCRIPT_NAME = 'desktop'

/** The recommended `uni-app.scripts.desktop` entry (DESKTOP is a standalone platform). */
export const DESKTOP_UNI_SCRIPT = {
  title: 'Desktop',
  env: { UNI_PLATFORM: 'h5' },
  define: { DESKTOP: true, H5: false, WEB: false },
}
