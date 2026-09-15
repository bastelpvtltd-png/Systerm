import { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '@/lib/supabase'
import * as cheerio from 'cheerio'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  try {
    const username = 'TV' 
    const password = '1tv@' 

    // 1. Trico Login Request
    const loginUrl = 'https://s2.tricologi.net/webuser/login.php'  
    const loginData = new URLSearchParams()
    loginData.append('username', username)
    loginData.append('password', password)
    loginData.append('login', '1')

    const loginResponse = await fetch(loginUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: loginData.toString(),
      redirect: 'manual' 
    })

    // Cookie එක ලබා ගැනීම
    let cookies = ''
    const setCookieHeader = loginResponse.headers.getSetCookie ? loginResponse.headers.getSetCookie() : [loginResponse.headers.get('set-cookie')]
    if (setCookieHeader && setCookieHeader.length > 0) {
        cookies = setCookieHeader.filter(Boolean).map((c: any) => c.split(';')[0]).join('; ')
    }

    // 2. Data Page එකට Request කිරීම
    const dataUrl = 'https://s2.tricologi.net/webuser/?option=tv&action=cont_in_yard_tv&req_type=raw'
    const dataResponse = await fetch(dataUrl, {
      method: 'GET',
      headers: { 
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })
    
    const html = await dataResponse.text()

    // 3. Cheerio හරහා HTML Parse කිරීම
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

    if (containers.length === 0) {
       return res.status(400).json({ 
         error: 'No valid containers found in HTML. Login might have failed or yard is empty.', 
         debugHtml: html.slice(0, 300) 
       })
    }

    // 4. Data Deduplication (ඔබ ඉල්ලූ පරිදි CUSDEC + CDN + Container No හරහා Duplicate අයින් කිරීම)
    const uniqueMap = new Map();
    containers.forEach(c => {
       // මේ තුනේම එකතුව එකම නම්, එය නැවත map එකට එකතු නොවේ
       const uniqueKey = `${c.container_no}-${c.cusdec_no}-${c.cdn}`;
       if (!uniqueMap.has(uniqueKey)) {
           uniqueMap.set(uniqueKey, c);
       }
    });
    const uniqueContainers = Array.from(uniqueMap.values());

    // 5. Supabase වෙත Save කිරීම
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