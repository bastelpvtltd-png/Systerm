import { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '@/lib/supabase'
import * as cheerio from 'cheerio'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  try {
    // 1. Username සහ Password මෙතනට දාලා තියෙනවා (ඔබට අවශ්‍ය නම් වෙනස් කරගත හැක)
    const username = 'TV' // මෙතනට ඔබේ Trico username එක දාන්න
    const password = '1tv@' // මෙතනට ඔබේ Trico password එක දාන්න

    // 2. Trico System එකට Login වීම සහ Session Cookies ලබා ගැනීම
    const loginUrl = 'https://s2.tricologi.net/webuser/login.php' 
    const loginData = new URLSearchParams()
    loginData.append('username', username)
    loginData.append('password', password)
    loginData.append('login', '1')

    const loginResponse = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: loginData.toString()
    })

    const cookies = loginResponse.headers.get('set-cookie') || ''

    // 3. Raw Data පිටුවට ගොස් දත්ත ලබා ගැනීම
    const dataUrl = 'https://s2.tricologi.net/webuser/?option=tv&action=cont_in_yard_tv&req_type=raw'
    const dataResponse = await fetch(dataUrl, {
      headers: { 'Cookie': cookies }
    })
    
    const html = await dataResponse.text()

    if (!html.includes('container-table') && !html.includes('tr')) {
       throw new Error('Failed to retrieve yard data. Login might have failed or session expired.')
    }

    // 4. Cheerio හරහා HTML Table එකේ ඇති සියලුම Rows (පේළි) එකවර කියවීම
    const $ = cheerio.load(html)
    const containers: any[] = []

    // Table එකේ ඇති සියලුම tr (rows) එකින් එක loop කරමින් එකතු කරයි
    $('#container-table tbody tr').each((_, row) => {
      const tds = $(row).find('td')
      if (tds.length >= 8) {
        const containerNo = $(tds[1]).text().trim()
        
        // හිස් පේළි මගහැර, දත්ත ඇති සියල්ල array එකට දාගනී
        if (containerNo) {
          containers.push({
            veh_no: $(tds[0]).text().trim(),
            container_no: containerNo,
            cusdec_no: $(tds[2]).text().trim(),
            cdn: $(tds[3]).text().trim(),
            shipper: $(tds[4]).text().trim(),
            time_in: $(tds[5]).text().trim(),
            duration: $(tds[6]).text().trim(),
            status: $(tds[7]).text().trim(),
            updated_at: new Date().toISOString()
          })
        }
      }
    })

    if (containers.length === 0) {
       return res.status(200).json({ message: 'No containers found in yard.', fetched: 0 })
    }

    // 5. Supabase එකට දත්ත එකවර (Bulk Upsert) යැවීම
    const { error: upsertError } = await supabase
      .from('trico_yard')
      .upsert(containers, { onConflict: 'container_no' })

    if (upsertError) throw upsertError

    return res.status(200).json({ 
      message: `Successfully synced. Total containers updated: ${containers.length}`, 
      fetched: containers.length 
    })

  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Something went wrong during sync' })
  }
}