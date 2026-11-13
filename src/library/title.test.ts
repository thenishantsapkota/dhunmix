import { describe, expect, it } from 'vitest'
import { cleanTitle } from './title'

describe('cleanTitle', () => {
  it('splits YouTube titles into song and details', () => {
    expect(cleanTitle('07 Radha - SOTY ｜ Alia Bhatt ｜ Shreya Ghosal.m4a')).toEqual({ title: 'Radha', sub: 'SOTY · Alia Bhatt · Shreya Ghosal' })
  })
  it('drops video noise words', () => {
    expect(cleanTitle('01 Nachde Ne Saare - Full Video ｜ Baar Baar Dekho.m4a')).toEqual({ title: 'Nachde Ne Saare', sub: 'Baar Baar Dekho' })
    expect(cleanTitle('HIGH HEELS TE NACHCHE Video Song ｜ KI & KA.m4a').title).toBe('HIGH HEELS TE NACHCHE')
  })
  it('drops the video id the YouTube helper adds', () => {
    expect(cleanTitle('Radha - SOTY ｜ Alia Bhatt [HgIW7P4dsXU].m4a')).toEqual({ title: 'Radha', sub: 'SOTY · Alia Bhatt' })
  })
  it('keeps plain file names as they are', () => {
    expect(cleanTitle('Resham Firiri.mp3')).toEqual({ title: 'Resham Firiri', sub: '' })
  })
})
