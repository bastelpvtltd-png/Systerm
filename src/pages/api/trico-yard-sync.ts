import { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '@/lib/supabase'
import * as cheerio from 'cheerio'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  try {
    const username = 'TV' 
    const password = '1tv@' 
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    
    let sessionCookies = ''

    // පියවර 1: මුලින්ම Login පිටුවට ගොස් Session Cookie එක ලබාගැනීම
    const initResponse = await fetch('https://s2.tricologi.net/webuser/?option=user', {
      method: 'GET',
      headers: { 'User-Agent': userAgent }
    })
    
    if (initResponse.headers.getSetCookie) {
        sessionCookies = initResponse.headers.getSetCookie().map((c: any) => c.split(';')[0]).join('; ')
    } else {
        const rawCookie = initResponse.headers.get('set-cookie')
        if (rawCookie) sessionCookies = rawCookie.split(';')[0]
    }

    // පියවර 2: ලබාගත් Session Cookie එක සමඟින් Username හා Password යැවීම (Login)
    const loginData = new URLSearchParams()
    loginData.append('username', username)
    loginData.append('password', password)
    loginData.append('login', '1') // ෆෝම් එක submit වන බව පෙන්වීමට

    const loginResponse = await fetch('https://s2.tricologi.net/webuser/login.php', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
        'Cookie': sessionCookies, // මුලින් ගත්තු Cookie එක යවමු
        'Referer': 'https://s2.tricologi.net/webuser/?option=user'
      },
      body: loginData.toString(),
      redirect: 'manual' 
    })

    // ලොග් වීමේදී අලුත් Cookie එකක් දුන්නොත් එයත් එකතු කරගැනීම
    if (loginResponse.headers.getSetCookie) {
        const newCookies = loginResponse.headers.getSetCookie().map((c: any) => c.split(';')[0]).join('; ')
        if (newCookies) sessionCookies = newCookies
    } else {
        const rawNewCookie = loginResponse.headers.get('set-cookie')
        if (rawNewCookie) sessionCookies = rawNewCookie.split(';')[0]
    }

    // පියවර 3: සාර්ථකව ලොග් වීමෙන් පසු Data පිටුවට Request කිරීම
    const dataUrl = 'https://s2.tricologi.net/webuser/?option=tv&action=cont_in_yard_tv&req_type=raw'
    const dataResponse = await fetch(dataUrl, {
      method: 'GET',
      headers: { 
        'Cookie': sessionCookies,
        'User-Agent': userAgent,
        'Referer': 'https://s2.tricologi.net/webuser/?option=tv'
      }
    })
    
    const html = await dataResponse.text()

    // 4. Cheerio හරහා HTML Parse කිරීම
    const $ = cheerio.load(html)
    const containers: any[] = []

    // සියලුම rows ලබා ගැනීම (50ක් හෝ 60ක් තිබුණත් සියල්ල ගනී)
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

    // HTML එක ඇතුලේ මුකුත්ම නැත්නම් (Login Failed නම්)
    if (containers.length === 0) {
       return res.status(400).json({ 
         error: 'Login failed or Yard is empty! Check Trico username/password.',
         debugHtml: html.slice(0, 150) // Error එකේදී ලැබුණු HTML එකේ මුල් ටික බලමු
       })
    }

    // 5. Data Deduplication (CUSDEC + CDN + Container No හරහා Duplicate අයින් කිරීම)
    const uniqueMap = new Map();
    containers.forEach(c => {
       const uniqueKey = `${c.container_no}-${c.cusdec_no}-${c.cdn}`;
       if (!uniqueMap.has(uniqueKey)) {
           uniqueMap.set(uniqueKey, c);
       }
    });
    const uniqueContainers = Array.from(uniqueMap.values());

    // 6. Supabase වෙත Save කිරීම
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