import type { BakedDesktopConfig } from '../baked'
import process from 'node:process'
import { app } from 'electron'
import { createDesktopApp } from '../runtime/index'

declare const __DESKTOP_CONFIG__: BakedDesktopConfig

// In dev the shell is launched from the uni process with an IPC channel on the
// fourth stdio stream; when that process dies the channel closes and the shell
// must quit instead of lingering as an orphan window. Production launches have
// no IPC channel, so this never fires there.
process.on('disconnect', () => app.quit())

createDesktopApp(__DESKTOP_CONFIG__)
