/** The custom uni platform script name, used as `uni -p desktop`. */
export const DESKTOP_SCRIPT_NAME = 'desktop'

/** The recommended `uni-app.scripts.desktop` entry (DESKTOP is a standalone platform). */
const DESKTOP_UNI_SCRIPT = {
  title: 'Desktop',
  env: { UNI_PLATFORM: 'h5' },
  define: { DESKTOP: true, H5: false, WEB: false },
}

/** The `uni-app.scripts.desktop` block as paste-ready package.json json. */
export function desktopScriptSnippet(): string {
  return JSON.stringify(
    { 'uni-app': { scripts: { [DESKTOP_SCRIPT_NAME]: DESKTOP_UNI_SCRIPT } } },
    null,
    2,
  )
}
