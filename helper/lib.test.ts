import { describe, expect, it } from 'vitest'
import { errorLine, folderName, idFromFileName, insideRoot, originAllowed, parseYouTubeUrl, retryable } from './lib.ts'

describe('parseYouTubeUrl', () => {
  it('turns a watch-in-playlist link into the whole playlist', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=HgIW7P4dsXU&list=PLYmK3JHhP4fdCl2NVP30MFIAQMFXVeBCG')).toEqual({
      url: 'https://www.youtube.com/playlist?list=PLYmK3JHhP4fdCl2NVP30MFIAQMFXVeBCG', kind: 'playlist',
    })
  })
  it('accepts single videos, short links and YouTube Music', () => {
    expect(parseYouTubeUrl('https://youtu.be/HgIW7P4dsXU')?.url).toBe('https://www.youtube.com/watch?v=HgIW7P4dsXU')
    expect(parseYouTubeUrl('  https://music.youtube.com/watch?v=HgIW7P4dsXU ')?.kind).toBe('video')
  })
  it('rejects other sites, plain http, junk ids and endless Mix radios', () => {
    expect(parseYouTubeUrl('https://evil.example/watch?v=HgIW7P4dsXU')).toBeNull()
    expect(parseYouTubeUrl('http://www.youtube.com/watch?v=HgIW7P4dsXU')).toBeNull()
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=$(rm -rf ~)')).toBeNull()
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=HgIW7P4dsXU&list=RDHgIW7P4dsXU')?.kind).toBe('video')
    expect(parseYouTubeUrl('not a url')).toBeNull()
  })
})

describe('originAllowed', () => {
  it('allows the app on any local port and configured origins only', () => {
    expect(originAllowed('http://localhost:5199', [])).toBe(true)
    expect(originAllowed('http://127.0.0.1:4173', [])).toBe(true)
    expect(originAllowed('https://dhunmix.app', ['https://dhunmix.app'])).toBe(true)
    expect(originAllowed('https://some-site.example', [])).toBe(false)
    expect(originAllowed('http://localhost.evil.example', [])).toBe(false)
    expect(originAllowed(undefined, [])).toBe(true)
  })
})

describe('paths', () => {
  it('keeps served files inside the music folder', () => {
    expect(insideRoot('/music', 'Wedding/song [HgIW7P4dsXU].m4a')).toBe('/music/Wedding/song [HgIW7P4dsXU].m4a')
    expect(insideRoot('/music', '../.ssh/id_rsa')).toBeNull()
    expect(insideRoot('/music', '/etc/passwd')).toBeNull()
    expect(insideRoot('/music', 'a/../../b')).toBeNull()
  })
  it('makes playlist titles safe folder names', () => {
    expect(folderName('Shaadi: Sangeet / Mehndi?')).toBe('Shaadi Sangeet Mehndi')
    expect(folderName('../..')).toBe('YouTube')
    expect(folderName('शादी के गाने')).toBe('शादी के गाने')
  })
  it('reads the video id back out of a downloaded file name', () => {
    expect(idFromFileName('Radha - SOTY [HgIW7P4dsXU].m4a')).toBe('HgIW7P4dsXU')
    expect(idFromFileName('Radha.m4a')).toBeNull()
  })
})

describe('retryable', () => {
  it('retries temporary refusals, not gone or private videos', () => {
    expect(retryable('unable to download video data: HTTP Error 403: Forbidden')).toBe(true)
    expect(retryable('HTTP Error 429: Too Many Requests')).toBe(true)
    expect(retryable('Private video. Sign in if you have been granted access')).toBe(false)
    expect(retryable('Video unavailable. This video has been removed by the uploader')).toBe(false)
  })
})

describe('errorLine', () => {
  it('keeps the reason a video failed', () => {
    expect(errorLine('WARNING: x\nERROR: [youtube] abcdefghijk: Private video. Sign in if you\'ve been granted access')).toBe(
      "Private video. Sign in if you've been granted access",
    )
  })
})
