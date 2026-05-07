import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { v4 as uuidv4 } from 'uuid'
import sharp from 'sharp'

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://masterbet.com',
  'https://masterbet.club',
  'https://www.masterbet.club',
  'https://www.panel.masterbet.club',
  'https://www.admin.masterbet.club',
  'https://7e4f-2800-2222-4000-73c-a474-b54e-fc3-b63a.ngrok-free.app',
  'https://stg-app.crossup.ai',
  'https://unoverruled-unredeemable-marilou.ngrok-free.dev',
  'https://admin-git-combos-ai-cross-up.vercel.app'
]

function getCorsHeaders(request: NextRequest) {
  const origin = request.headers.get('origin') ?? ''
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) })
}

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY || ''
  }
})

const BUCKET_NAME = process.env.CLOUDFLARE_BUCKET_NAME || ''
const PUBLIC_CDN_URL = process.env.NEXT_PUBLIC_CLOUDFLARE_CDN_URL || ''


export async function POST(request: NextRequest) {
  try {
    // Obtener el archivo del FormData
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    
    const corsHeaders = getCorsHeaders(request)

    if (!file) {
      return NextResponse.json({ message: 'No se proporcionó ningún archivo' }, { status: 400, headers: corsHeaders })
    }

    // Generar un nombre único para el archivo
    const fileExt = file.name.split('.').pop() || 'jpg'
    const uniqueFilename = `${uuidv4()}.${fileExt}`
    const webpFilename = uniqueFilename.replace(`.${fileExt}`, '.webp')
    
    // Convertir el archivo a un buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    // Procesar la imagen con sharp para crear diferentes tamaños
    const originalImage = sharp(buffer)
    const metadata = await originalImage.metadata()
    
    // Crear versiones de diferentes tamaños
    const smallBuffer = await sharp(buffer)
      .resize(300, null, { fit: 'inside' })
      .webp({ quality: 80 })
      .toBuffer()
      
    const mediumBuffer = await sharp(buffer)
      .resize(600, null, { fit: 'inside' })
      .webp({ quality: 80 })
      .toBuffer()
      
    const originalBuffer = await sharp(buffer)
      .webp({ quality: 85 })
      .toBuffer()
    
    // Subir cada versión a R2
    const uploadPromises = [
      uploadToR2(smallBuffer, `small/${webpFilename}`, 'image/webp'),
      uploadToR2(mediumBuffer, `medium/${webpFilename}`, 'image/webp'),
      uploadToR2(originalBuffer, `original/${webpFilename}`, 'image/webp')
    ]
    
    await Promise.all(uploadPromises)
    
    // Construir las URLs para cada tamaño
    const smallUrl = `${PUBLIC_CDN_URL}/small/${webpFilename}`
    const mediumUrl = `${PUBLIC_CDN_URL}/medium/${webpFilename}`
    const originalUrl = `${PUBLIC_CDN_URL}/original/${webpFilename}`
    
    return NextResponse.json({
      filename: webpFilename,
      originalUrl,
      sizes: {
        small: smallUrl,
        medium: mediumUrl,
        original: originalUrl
      }
    }, { headers: corsHeaders })
    
  } catch (error) {
    console.error('Error al procesar o subir la imagen:', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500, headers: getCorsHeaders(request) }
    )
  }
}

// Función auxiliar para subir a R2
async function uploadToR2(buffer: Buffer, key: string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000'
  })
  
  return s3Client.send(command)
}
