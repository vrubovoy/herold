import { describe, it, expect } from 'vitest'
import type { MessageStructureObject } from 'imapflow'
import { collectAttachmentParts } from '../sync/attachmentParts.js'

describe('collectAttachmentParts', () => {
  it('collects a leaf node with a filename via dispositionParameters.filename', () => {
    const node: MessageStructureObject = {
      part: '2',
      type: 'application/pdf',
      size: 4321,
      disposition: 'attachment',
      dispositionParameters: { filename: 'invoice.pdf' },
    }
    const result = collectAttachmentParts(node)
    expect(result).toEqual([
      { partId: '2', filename: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 4321 },
    ])
  })

  it('collects a leaf node with a filename via parameters.name (Content-Type name= fallback)', () => {
    const node: MessageStructureObject = {
      part: '3',
      type: 'image/png',
      size: 9999,
      parameters: { name: 'screenshot.png' },
    }
    const result = collectAttachmentParts(node)
    expect(result).toEqual([
      { partId: '3', filename: 'screenshot.png', mimeType: 'image/png', sizeBytes: 9999 },
    ])
  })

  it('defaults sizeBytes to 0 when size is absent', () => {
    const node: MessageStructureObject = {
      part: '4',
      type: 'application/octet-stream',
      dispositionParameters: { filename: 'no-size.bin' },
    }
    const result = collectAttachmentParts(node)
    expect(result).toEqual([
      { partId: '4', filename: 'no-size.bin', mimeType: 'application/octet-stream', sizeBytes: 0 },
    ])
  })

  it('does NOT collect a plain text/plain leaf with no filename at all', () => {
    const node: MessageStructureObject = {
      part: '1',
      type: 'text/plain',
      size: 42,
    }
    expect(collectAttachmentParts(node)).toEqual([])
  })

  it('does NOT collect a plain text/html leaf with no filename at all', () => {
    const node: MessageStructureObject = {
      part: '1.2',
      type: 'text/html',
      size: 128,
    }
    expect(collectAttachmentParts(node)).toEqual([])
  })

  it('does NOT collect a leaf that has a filename but is missing its own part identifier', () => {
    const node: MessageStructureObject = {
      type: 'application/pdf',
      size: 100,
      dispositionParameters: { filename: 'no-part-id.pdf' },
    }
    expect(collectAttachmentParts(node)).toEqual([])
  })

  it('never collects a multipart node itself, only its descendant leaves, at any depth', () => {
    const tree: MessageStructureObject = {
      part: '',
      type: 'multipart/mixed',
      childNodes: [
        {
          part: '1',
          type: 'multipart/alternative',
          childNodes: [
            { part: '1.1', type: 'text/plain', size: 50 },
            { part: '1.2', type: 'text/html', size: 200 },
          ],
        },
        {
          part: '2',
          type: 'application/pdf',
          size: 5555,
          disposition: 'attachment',
          dispositionParameters: { filename: 'invoice.pdf' },
        },
        {
          part: '3',
          type: 'image/jpeg',
          size: 7777,
          disposition: 'attachment',
          dispositionParameters: { filename: 'photo.jpg' },
        },
      ],
    }

    const result = collectAttachmentParts(tree)
    expect(result).toHaveLength(2)
    expect(result).toEqual(
      expect.arrayContaining([
        { partId: '2', filename: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 5555 },
        { partId: '3', filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 7777 },
      ]),
    )
    // Neither the multipart container itself nor its plain text children
    // ever show up in the result.
    expect(result.some((a) => a.mimeType.startsWith('multipart/'))).toBe(false)
    expect(result.some((a) => a.mimeType === 'text/plain')).toBe(false)
    expect(result.some((a) => a.mimeType === 'text/html')).toBe(false)
  })

  it('collects an inline-disposition leaf with a filename (embedded HTML image) just like an attachment one', () => {
    const node: MessageStructureObject = {
      part: '2',
      type: 'image/png',
      size: 1234,
      disposition: 'inline',
      dispositionParameters: { filename: 'logo.png' },
    }
    const result = collectAttachmentParts(node)
    expect(result).toEqual([
      { partId: '2', filename: 'logo.png', mimeType: 'image/png', sizeBytes: 1234 },
    ])
  })

  it('a multipart/mixed with one inline and one regular attachment leaf collects both', () => {
    const tree: MessageStructureObject = {
      part: '',
      type: 'multipart/mixed',
      childNodes: [
        { part: '1', type: 'text/plain', size: 10 },
        {
          part: '2',
          type: 'image/png',
          size: 2000,
          disposition: 'inline',
          dispositionParameters: { filename: 'logo.png' },
        },
        {
          part: '3',
          type: 'application/pdf',
          size: 3000,
          disposition: 'attachment',
          dispositionParameters: { filename: 'invoice.pdf' },
        },
      ],
    }
    const result = collectAttachmentParts(tree)
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.filename).sort()).toEqual(['invoice.pdf', 'logo.png'])
  })

  it('returns an empty array for a message with no attachments at all (single non-multipart text/plain leaf)', () => {
    const node: MessageStructureObject = {
      part: '1',
      type: 'text/plain',
      size: 500,
    }
    expect(collectAttachmentParts(node)).toEqual([])
  })

  it('returns an empty array for a multipart/alternative with only text/plain + text/html children', () => {
    const tree: MessageStructureObject = {
      part: '',
      type: 'multipart/alternative',
      childNodes: [
        { part: '1', type: 'text/plain', size: 100 },
        { part: '2', type: 'text/html', size: 300 },
      ],
    }
    expect(collectAttachmentParts(tree)).toEqual([])
  })

  it('treats a node with an empty childNodes array as a leaf, not a multipart container', () => {
    const node: MessageStructureObject = {
      part: '1',
      type: 'text/plain',
      size: 10,
      childNodes: [],
    }
    expect(collectAttachmentParts(node)).toEqual([])
  })
})
