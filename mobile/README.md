# HR System — แอปมือถือ (Expo)

คู่มือรันโปรเจกต์ด้วย [Expo](https://expo.dev) บนเครื่องพัฒนา

เอกสารโปรเจกต์ทั้ง repo (บทบาท, ตาราง Supabase, ความคืบหน้า, กฎให้ Agent): [`docs/PROJECT_GUIDE.md`](../docs/PROJECT_GUIDE.md)

## สำคัญ: รันจากโฟลเดอร์ `mobile` เท่านั้น

โปรเจกต์ Expo อยู่ที่ **`HR System/mobile`** ไม่ใช่ที่โฟลเดอร์ราก `HR System`

ถ้ารัน `npx expo start` ตอนอยู่ที่ `C:\...\HR System` (ไม่ได้ `cd mobile`) จะขึ้นว่า:

`Unable to find expo in this project - have you run yarn / npm install yet?`

**วิธีที่ถูก:**

```powershell
cd "C:\Users\sawarin\Desktop\HR System\mobile"
npm install
npx expo start
```

ข้อความเตือนเรื่อง **legacy expo-cli** มักเกิดเมื่อเคยติดตั้ง `expo-cli` แบบ global เก่า — ให้ใช้คำสั่งด้านบนในโฟลเดอร์ `mobile` เพื่อใช้ **Expo CLI ที่มากับแพ็กเกจ `expo` ในโปรเจกต์** (แนะนำ) หรือถอน global เก่าด้วย `npm uninstall -g expo-cli`

## สิ่งที่ต้องมี

- **Node.js** เวอร์ชันที่ Expo รองรับ (แนะนำ LTS ล่าสุด)
- **npm** (หรือ yarn / pnpm ตามที่ใช้)

## ติดตั้งแพ็กเกจ

เปิดเทอร์มินัลแล้วเข้าโฟลเดอร์แอป:

```bash
cd mobile
npm install
```

## ตั้งค่า Supabase (จำเป็น)

สร้างไฟล์ `.env` ในโฟลเดอร์ `mobile` (ถ้ายังไม่มี) แล้วใส่ค่าจากโปรเจกต์ Supabase:

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

- ดึงค่าได้ที่ Supabase Dashboard → **Project Settings** → **API**
- **อย่า** commit ไฟล์ `.env` ขึ้น Git (เก็บเป็นความลับ)

### Expo web บน Vercel กับ Supabase

- ค่า `EXPO_PUBLIC_SUPABASE_URL` และ `EXPO_PUBLIC_SUPABASE_ANON_KEY` ต้องตั้งใน **Vercel → Project → Settings → Environment Variables** ของโปรเจกต์ที่ลิงก์กับโฟลเดอร์ `mobile` (หรือรากที่มี `vercel.json` ชี้ `build:web` ไปที่ `mobile`) และใช้ **ชุดเดียวกับ** โปรเจกต์ Supabase ที่คุณรัน migration — ค่าเหล่านี้ถูกฝังตอน **build** ถ้าแก้ env ต้อง **deploy ใหม่**
- พฤติกรรมต่างจาก localhost เกือบทั้งหมดมาจาก **ฐานข้อมูลบน cloud ยังไม่ได้รัน migration ล่าสุด** หรือ **`profiles.branch_id`** บน production ไม่ตรง/ว่าง — ไม่ใช่เพราะ “Vercel ไม่ส่ง bundle” โดยทั่วไป
- รัน migration ขึ้น Supabase ที่ใช้จริง: จากราก repo `npm run db:push` (หลัง `supabase link`) หรือวาง SQL ใน Dashboard → SQL Editor
- Deploy แนะนำจากราก repo: `npm run vercel:prod` (สคริปต์ใช้ `--cwd mobile`) แทน `vercel --prod` ที่โฟลเดอร์ผิดอาจลิงก์โปรเจกต์คนละชุด

## รันแอป

```bash
cd mobile
npx expo start
```

หลังคำสั่งนี้จะเปิด **Metro** และแสดงเมนูในเทอร์มินัล / หน้าเว็บ DevTools

### เปิดบนอุปกรณ์ / เบราว์เซอร์

| การกระทำ | คำสั่งหรือวิธี |
|-----------|----------------|
| **เว็บ** | กด `w` ในเทอร์มินัล หรือรัน `npx expo start --web` |
| **Android (เอมูเลเตอร์ / สาย USB)** | กด `a` หรือรัน `npx expo start --android` |
| **iOS (เฉพาะ macOS)** | กด `i` หรือรัน `npx expo start --ios` |
| **มือถือจริง** | ติดตั้งแอป **Expo Go** แล้วสแกน QR จากหน้าจอเทอร์มินัล |

### รันครั้งเดียวโดยไม่ต้องเปิดเมนูแบบโต้ตอบ

อย่าลืม `cd mobile` ก่อน:

```bash
cd mobile
npx expo start --web
```

## เคล็ดลับ

- ถ้าแก้ `.env` แล้วค่าไม่อัปเดต ให้ **หยุด Metro** (Ctrl+C) แล้วรัน `npx expo start` ใหม่
- ถ้า Metro ค้างหรือ cache พัง ลอง: `npx expo start --clear`
- โฟลเดอร์ `.expo` เป็นไฟล์ที่เครื่องสร้างเอง — ถ้า `tsc` ฟ้องที่ `.expo/types/router.d.ts` ลองลบ `.expo` แล้วรัน `npx expo start` อีกครั้งให้สร้างใหม่

## โครงสร้างที่เกี่ยวข้อง

- `app/` — หน้าจอและ routing (expo-router)
- `lib/` — เรียก Supabase และ helper
- `constants/` — ธีมสี
- `../supabase/` — SQL / migration ฝั่งเซิร์ฟเวอร์ (ไม่ใช่ส่วนของ Expo โดยตรง)
