# System Requirements & Workflow Specification

_Saved: 2026-07-08_

## 1. Bug Fixes සහ UI වෙනස්කම් (PDF Upload & Preview)

- **PDF Upload Issue Fix කිරීම:** පළමු වරට PDF upload කිරීමේදී සිදුවන ප්‍රමාදය සහ error එක නිරාකරණය කිරීම. (Refresh කිරීමෙන් තොරව එකවරම upload වීමට සැලැස්වීම).
- **Save Error Fix කිරීම:** Save කිරීමේදී සෑම PDF එකකටම එන "invalid input syntax" error එක විසඳීම (Database එකට යන data type එක පරීක්ෂා කර නිවැරදි කිරීම).
- **Preview Access Control:** Preview එකේදී සියලුම PDF නොපෙන්වා, අදාළ user විසින් upload කරන ලද PDF පමණක් පෙනෙන ආකාරයට filter කිරීම.

## 2. නව "Shipment" Tab එකක් නිර්මාණය කිරීම

- **Shipment Entry Form:** අලුතින් order එකක් ආ විට Shipment එකක් විවෘත කිරීමට පහසුකම් සැලසීම.
- **අවශ්‍ය Fields:** Reference, Shipper, Shipment Invoice Number, Packing Number, Consignee.
- **Auto-suggest & Filter:** Shipper සහ Consignee type කරන විට, Cusdec database එකේ ඇති දත්ත වලින් filter වී පෙන්වීම. අවශ්‍ය නම් අලුත් කෙනෙක්ගේ නමක් අතින් type කර ඇතුළත් කිරීමටද (manual entry) හැකි වීම.
- **Temporary Save:** මෙම දත්ත පුරවා Save කළ පසු, ඒවා ප්‍රධාන database එකට නොගොස් අලුත් "Temporary Shipment Table" එකක තැන්පත් වීම.

## 3. Document Creation (Invoice & Packing List)

- **එක් ස්ථානයක සිට ක්‍රියාත්මක වීම:** Invoice සහ Packing list සෑදීම එකම පෝරමයකින් (Sheet) සිදු කිරීම.
- **අවශ්‍ය Fields:** Invoice Number, Reference Number, Date, Exporter, Consignee, Container Mark, Item Description, Packages, Type of Package, G/W, N/W, Unit Price, Total Value, Total Gross, Total Net, Terms of Delivery, Payment Type, Bank Details, Booking, Vessel, Voyage, COC, VOC, Discharge, Loading, Origin. (Item description සහ Payment type එකකට වඩා add කිරීමට පහසුකම් තිබිය යුතුය).
- **Auto-fill & Data Pulling:** Shipper select කළ විට, ඔහුට අදාළව කලින් ඇතුළත් කර ඇති Bank Details, Consignee වැනි දත්ත ස්වයංක්‍රීයව (Auto-fill) පිරවීම.
- **Edited Tag:** Auto-fill වූ දත්ත user විසින් වෙනස් කළහොත් (Edit), එම field එක ඉදිරියෙන් "Edited" ලෙස කුඩා tag එකක් පෙන්වීම. වෙනස් නොකළ ඒවා සාමාන්‍ය පරිදි තිබීම.
- **Temporary Document Option:** යම් හෙයකින් අදාළ shipment එකට Reference එකක් generate වී නැතිනම්, "Temporary" කියන button එක click කර තාවකාලිකව document එකක් සාදා ගැනීමට ඉඩ දීම. මෙය Save නොවිය යුතු අතර, Download කරගෙන Page එක refresh කළ පසු දත්ත මැකී යා යුතුය.
- **PDF Generation:**
  - පුරවන ලද දත්ත වලින් Invoice එක සහ Packing List එක සඳහා වෙන වෙනම PDF දෙකක් generate කිරීමට button දෙකක් ලබා දීම.
  - සෑම දත්තයක්ම නැවත ඇතුළත් කිරීමට අවශ්‍ය නොවන පරිදි, form එකේ පුරවන දත්ත පමණක් PDF එකට ඇතුළත් වීම.
- **PDF Quality & Size:** PDF එක අනිවාර්යයෙන්ම එක් පිටුවකට (One page) සීමා විය යුතු අතර, size එක 2MB වලට වඩා අඩු විය යුතුය.
- **Auto Attach Workflow:** PDF එක generate වී, එය view කර නිවැරදි නම් Download කළ වහාම, අදාළ Shipment එකට එම PDF එක ස්වයංක්‍රීයව (Auto-attach) link වීම.

## 4. Cusdec Automation සහ Database Management

- **Invoice Number Column:** Cusdec table එකට අලුතින් 'Invoice Number' කියන column එක එකතු කිරීම.
- **Auto-Match කිරීම:** Cusdec එකක් scan කර/upload කර දමන විට, එහි ඇති Invoice Number එක, අප කලින් හැදූ Shipment table එකේ Invoice Number එක සමඟ match කර බැලීම.
- **Data Merge හා ප්‍රමුඛතාවය (Priority rule):** Match වූ විට, Cusdec එකෙන් extract වූ දත්ත කිසිවක් වෙනස් නොවිය යුතුය (Shipment data වලින් overwrite නොවිය යුතුය). Cusdec එකෙන් extract නොවූ, අඩුවන අනෙකුත් දත්ත පමණක් Shipment table එකෙන් ලබාගෙන Auto-fill වී සම්පූර්ණ වාර්තාව Save විය යුතුය.
- **Shipment Table එකෙන් ඉවත් කිරීම (Delete Action):** ඉහත ආකාරයට දත්ත සාර්ථකව එක්වී Cusdec row එක සම්පූර්ණ වී Save වූ වහාම, අදාළ වාර්තාව (row එක) අනිවාර්යයෙන්ම Shipment table එකෙන් සම්පූර්ණයෙන්ම ඉවත් (delete) විය යුතුය.
- **Manual Match:** Auto match නොවුවහොත්, Shipment table එකෙන් අදාළ row එක අතින් තෝරාගැනීමට (Manual Select) පහසුකම් දීම.
- **Normal Cusdec Save:** Shipment එකක් කලින් සෑදී නැති (Reference නැති) Cusdec එකක් නම්, එය සාමාන්‍ය පරිදි Save වී ඊට අදාළ Reference අංකය වෙනම generate වීම.
- **Google Drive Storage:** Invoice සහ Packing list වෙනම Folder එකක Google Drive එකේ save වී, එහි Link එක පමණක් Database එකේ save වීම.

## 5. Shipment Overview සහ User Access

- **New Filters:** දැනට ඇති CDN, Barcode, Boat note වලට අමතරව 'Reference' සහ 'Invoice Number' මගින් filter කිරීමට පහසුකම් Overview එකට එකතු කිරීම.
- **Section-wise View:** Shipment Overview එකේදී සියලුම දත්ත පිළිවෙලට කොටස් වශයෙන් (Section wise) ලස්සනට බලාගැනීමට සැලැස්වීම.
- **User Access Control (Permissions):**
  - සෑම user කෙනෙකුටම තමාට අදාළ Shippers ලාගේ දත්ත පමණක් බලාගැනීමට අවසර දීම (Admin විසින් Shipper කෙනෙක් assign කළ විට ඒ Shipper ගේ දත්ත පමණක් පෙනීම).
  - Admin කෙනෙක් "All" ලෙස select කළ විට සියලු දත්ත පෙනීම.
  - වෙනත් Shippers ලාගේ කිසිදු දත්තයක් unauthorized users ලාට නොපෙනීම.

## 6. Template Addition Logic

Word හෝ Excel Templates upload කිරීමේදී පද්ධතියට අදාළ දත්ත හඳුනාගැනීම සඳහා Placeholders භාවිතා කළ යුතුය (උදාහරණයක් ලෙස: `{{invoice_number}}`, `{{consignee_name}}`, `{{total_value}}`). පරිශීලකයාට Template file එකක් upload කිරීමට option එකක් ලබා දී, Form එකේ පුරවන දත්ත අදාළ tags සමඟ ස්වයංක්‍රීයව map වී අවසානයේ PDF එකක් ලෙස generate විය යුතුය. (මෙය Python හි docxtpl වැනි ක්‍රමවේදයකින් සිදු කළ හැක).

---

## Error Reporting Requirement

Ekath ekath feature ekak implement karana koda, "hariyatama error ekak" enawanam, eka user-facing UI ekaka (visible error message / toast) penna vidihata handle karanna — silent failure epa. Console eke witharak nemai, screen eke penna one.
