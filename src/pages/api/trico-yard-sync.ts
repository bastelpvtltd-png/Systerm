import { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '@/lib/supabase'
import * as cheerio from 'cheerio'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  try {
    const username = 'TV' 
    const password = '1tv@' 
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    
    // Cookie නිවැරදිව කළමනාකරණය කිරීම
    const cookieMap = new Map<string, string>()
    function extractCookies(response: Response) {
        const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
        const rawCookie = response.headers.get('set-cookie')
        const allCookies = setCookies.length > 0 ? setCookies : (rawCookie ? rawCookie.split(/(?<!Expires=\w{3}),/i) : [])
        
        allCookies.forEach(c => {
            const keyVal = c.split(';')[0].trim()
            const [key, ...valParts] = keyVal.split('=')
            if (key && valParts.length > 0) cookieMap.set(key.trim(), valParts.join('=').trim())
        })
    }
    const getCookieString = () => Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ')

    // පියවර 1: Cache නොවන ලෙස Login පිටුව ලබා ගැනීම (Hidden tokens ලබාගැනීමට)
    const initResponse = await fetch('https://s2.tricologi.net/webuser/?option=user', {
      method: 'GET',
      headers: { 'User-Agent': userAgent },
      cache: 'no-store' // අනිවාර්යයෙන්ම Cache වීම නවත්වයි
    })
    
    extractCookies(initResponse)
    const initHtml = await initResponse.text()
    const $init = cheerio.load(initHtml)
    
    const form = $init('form')
    if (form.length === 0) throw new Error(`Cannot find login form. Site returned: ${initHtml.slice(0, 80)}`)
    
    let actionPath = form.attr('action') || 'login.php'
    const loginUrl = actionPath.startsWith('http') ? actionPath : `https://s2.tricologi.net/webuser/${actionPath.replace(/^\//, '')}`
    
    const loginData = new URLSearchParams()
    let userSet = false; let passSet = false;
    
    // Form එකේ ඇති සියලුම Inputs (Hidden ඇතුළුව) ලබාගෙන Username/Password පුරවයි
    form.find('input').each((_, el) => {
        const name = $init(el).attr('name')
        const value = $init(el).attr('value') || ''
        const type = ($init(el).attr('type') || '').toLowerCase()
        
        if (name) {
            if (!userSet && (type === 'text' || name.toLowerCase().includes('user'))) {
                loginData.set(name, username); userSet = true
            } else if (!passSet && (type === 'password' || name.toLowerCase().includes('pass'))) {
                loginData.set(name, password); passSet = true
            } else {
                loginData.set(name, value) // Hidden Tokens එකතු කිරීම
            }
        }
    })
    
    const submitBtn = form.find('button[type="submit"]')
    if (submitBtn.length > 0 && submitBtn.attr('name')) {
        loginData.set(submitBtn.attr('name')!, submitBtn.attr('value') || '1')
    } else {
        loginData.set('login', '1')
    }

    // පියවර 2: Login Data POST කිරීම
    const loginResponse = await fetch(loginUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
        'Cookie': getCookieString(),
        'Referer': 'https://s2.tricologi.net/webuser/?option=user'
      },
      body: loginData.toString(),
      redirect: 'manual',
      cache: 'no-store'
    })
    
    extractCookies(loginResponse)

    // පියවර 3: සාර්ථකව ලොග් වීමෙන් පසු Data පිටුවට Request කිරීම
    const dataUrl = 'https://s2.tricologi.net/webuser/?option=tv&action=cont_in_yard_tv&req_type=raw'
    const dataResponse = await fetch(dataUrl, {
      method: 'GET',
      headers: { 
        'Cookie': getCookieString(),
        'User-Agent': userAgent,
        'Referer': 'https://s2.tricologi.net/webuser/?option=tv'
      },
      cache: 'no-store'
    })
    
    const html = await dataResponse.text()

    // පියවර 4: Data Parse කිරීම
    const $ = cheerio.load(html)
    const containers: any[] = []

    $('tbody tr').each((_, row) => {
      const tds = $(row).find('td')
      if (tds.length >= 8) {
        const containerNo = $(tds[1]).text().trim()
        if (containerNo && containerNo.toLowerCase() !== 'container no.' && containerNo.toLowerCase() !== 'container no') {
          containers.push({
            veh_no: $(tds[0]).text().trim(),
            container_no: containerNo,
            cusdec_no: $(tds[2]).text().trim(),
            cdn: $(tds[3]).text().trim(),
            shipper: $(tds[4]).text().trim(),
            time_in: $(tds[5]).text().trim(),
            duration: $(tds[6]).text().trim(),
            status: $(tds[7]).text().replace(/\s+/g, '').trim(), 
            updated_at: new Date().toISOString()
          })
        }
      }
    })

    // ලොග් වීම අසාර්ථක වුවහොත්, Trico එකෙන් එවපු සැබෑ පණිවිඩය UI එකේ පෙන්වයි
    if (containers.length === 0) {
       let snippet = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
       if (!snippet) snippet = html.slice(0, 100)
       return res.status(400).json({ 
         error: `Trico Blocked / Empty. Server Message: "${snippet}"` 
       })
    }

    // පියවර 5: Data Deduplication (Duplicate අයින් කිරීම)
    const uniqueMap = new Map()
    containers.forEach(c => {
       const uniqueKey = `${c.container_no}-${c.cusdec_no}-${c.cdn}`
       if (!uniqueMap.has(uniqueKey)) uniqueMap.set(uniqueKey, c)
    })
    const uniqueContainers = Array.from(uniqueMap.values())

    // පියවර 6: Supabase වෙත Save කිරීම
    const { error: upsertError } = await supabase
      .from('trico_yard')
      .upsert(uniqueContainers, { onConflict: 'container_no' })

    if (upsertError) throw upsertError

    return res.status(200).json({ 
      message: `Successfully synced. Total unique containers updated: ${uniqueContainers.length}`, 
      fetched: uniqueContainers.length 
    })

  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Something went wrong during sync' })
  }
}