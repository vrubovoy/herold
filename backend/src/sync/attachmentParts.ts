import type { MessageStructureObject } from 'imapflow'

export interface AttachmentPart {
  partId: string
  filename: string
  mimeType: string
  sizeBytes: number
}

// Recursively walks a message's IMAP BODYSTRUCTURE tree (as imapflow
// parses it) and collects every leaf part that carries a filename - the
// standard signal for "this is an attachment, not the readable body",
// whether it's Content-Disposition: attachment (a real file) or inline
// (e.g. an image embedded in an HTML email) - both are equally
// downloadable, neither is the primary text/plain or text/html body,
// which never carries a filename parameter in a well-formed message.
export function collectAttachmentParts(node: MessageStructureObject): AttachmentPart[] {
  const results: AttachmentPart[] = []

  function walk(n: MessageStructureObject) {
    if (n.childNodes && n.childNodes.length > 0) {
      for (const child of n.childNodes) walk(child)
      return
    }
    const filename = n.dispositionParameters?.['filename'] ?? n.parameters?.['name']
    if (!filename || !n.part) return
    results.push({
      partId: n.part,
      filename,
      mimeType: n.type,
      sizeBytes: n.size ?? 0,
    })
  }

  walk(node)
  return results
}
