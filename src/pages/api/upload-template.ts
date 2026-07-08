import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import { requireAuth } from '@/lib/serverAuth'

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// A .docx is a zip of XML parts. word/document.xml holds the body text, but
// Word frequently splits a single {{tag}} across several <w:t> runs (once
// for formatting reasons), so placeholder text can't be regex-matched
// straight out of the raw XML — only after each paragraph's <w:t> runs are
// concatenated back into plain text first.
function extractParagraphs(documentXml: string): string[] {
  const paragraphs = documentXml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []
  return paragraphs.map(p => {
    const runs = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || []
    return runs
      .map(r => r.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, ''))
      .join('')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const authed = await requireAuth(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

    const { base64, fileName, name, driveUrl } = req.body
    if (!base64 || !fileName) return res.status(400).json({ error: 'base64 and fileName required' })
    if (!/\.docx$/i.test(fileName)) return res.status(400).json({ error: 'Only .docx templates are supported' })

    const zip = await JSZip.loadAsync(Buffer.from(base64, 'base64'))
    const documentXml = await zip.file('word/document.xml')?.async('string')
    if (!documentXml) return res.status(400).json({ error: 'Could not read document.xml — is this a valid .docx file?' })

    const paragraphs = extractParagraphs(documentXml)
    const rawText = paragraphs.join('\n')

    const placeholderSet = new Set<string>()
    const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(rawText))) placeholderSet.add(m[1])
    const placeholders = Array.from(placeholderSet)

    const { data, error } = await supabaseAdmin
      .from('doc_templates')
      .insert({
        name: name || fileName, file_name: fileName, drive_url: driveUrl || null,
        raw_text: rawText, placeholders, created_by: authed.userId,
      })
      .select()
      .single()
    if (error) return res.status(400).json({ error: error.message })

    res.json({ template: data })
  } catch (err: any) {
    console.error('[upload-template] error:', err)
    res.status(500).json({ error: err.message })
  }
}
