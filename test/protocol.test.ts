import { describe, expect, it } from 'vitest'
import { DESKTOP_FILE_SCHEME, EXTENSION_BY_MIME, mimeFromExtension, parseDesktopFileUrl, toDesktopFileUrl } from '../src/shared/protocol'

describe('desktop-file url', () => {
  it('round-trips absolute paths', () => {
    const cases = [
      '/home/user/pics/图片 name.png',
      'C:\\Users\\me\\AppData\\Local\\Temp\\a b.jpg',
      '/tmp/simple.mp4',
    ]
    for (const path of cases) {
      expect(parseDesktopFileUrl(toDesktopFileUrl(path))).toBe(path)
    }
  })

  it('builds urls with the custom scheme', () => {
    expect(toDesktopFileUrl('/tmp/a.png')).toMatch(new RegExp(`^${DESKTOP_FILE_SCHEME}://f/`))
  })

  it('rejects foreign protocols', () => {
    expect(() => parseDesktopFileUrl('file:///etc/passwd')).toThrow('unsupported protocol')
  })
})

describe('mimeFromExtension', () => {
  it('maps known extensions and falls back to octet-stream', () => {
    expect(mimeFromExtension('/a/b.PNG')).toBe('image/png')
    expect(mimeFromExtension('/a/b.mp4')).toBe('video/mp4')
    expect(mimeFromExtension('/a/b.unknown')).toBe('application/octet-stream')
  })

  it('round-trips the document types desktop users open', () => {
    expect(mimeFromExtension('/a/b.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(EXTENSION_BY_MIME['application/vnd.openxmlformats-officedocument.wordprocessingml.document']).toBe('.docx')
    // `.htm` precedes `.html` in the table, so the reverse map resolves to `.html`.
    expect(EXTENSION_BY_MIME['text/html']).toBe('.html')
  })
})
