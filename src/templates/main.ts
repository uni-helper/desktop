import type { BakedDesktopConfig } from '../baked'
import { createDesktopApp } from '../runtime/index'

declare const __DESKTOP_CONFIG__: BakedDesktopConfig

createDesktopApp(__DESKTOP_CONFIG__)
