#!/usr/bin/env node
import { S3Client, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import { createHash } from 'crypto'

// 配置 Cloudflare R2
const R2_CONFIG = {
  accountId: process.env.R2_ACCOUNT_ID || '',
  accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  bucket: process.env.R2_BUCKET || 'crowvpn-updates',
  endpoint: `https://${process.env.R2_ACCOUNT_ID || ''}.r2.cloudflarestorage.com`
}

if (!R2_CONFIG.accountId || !R2_CONFIG.accessKeyId || !R2_CONFIG.secretAccessKey) {
  console.error('❌ 错误: 请设置环境变量 R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY')
  process.exit(1)
}

// 创建 S3 客户端
const s3Client = new S3Client({
  region: 'auto',
  endpoint: R2_CONFIG.endpoint,
  credentials: {
    accessKeyId: R2_CONFIG.accessKeyId,
    secretAccessKey: R2_CONFIG.secretAccessKey
  }
})

// 上传文件的阈值（超过 100MB 使用分片上传）
const MULTIPART_THRESHOLD = 100 * 1024 * 1024 // 100MB
const PART_SIZE = 50 * 1024 * 1024 // 50MB per part

/**
 * 普通上传（小于阈值）
 */
async function uploadSmallFile(filePath, key) {
  console.log(`📤 普通上传: ${basename(filePath)}`)
  
  const fileBuffer = readFileSync(filePath)
  const command = new PutObjectCommand({
    Bucket: R2_CONFIG.bucket,
    Key: key,
    Body: fileBuffer
  })
  
  await s3Client.send(command)
  console.log(`✅ 上传成功: ${key}`)
}

/**
 * 分片上传（大于阈值）
 */
async function uploadLargeFile(filePath, key) {
  console.log(`📤 分片上传: ${basename(filePath)}`)
  
  const fileSize = statSync(filePath).size
  const fileBuffer = readFileSync(filePath)
  
  // 初始化分片上传
  const createCommand = new CreateMultipartUploadCommand({
    Bucket: R2_CONFIG.bucket,
    Key: key
  })
  const { UploadId } = await s3Client.send(createCommand)
  
  try {
    // 上传各个分片
    const parts = []
    let partNumber = 1
    let offset = 0
    
    while (offset < fileSize) {
      const end = Math.min(offset + PART_SIZE, fileSize)
      const chunk = fileBuffer.subarray(offset, end)
      
      console.log(`📦 上传分片 ${partNumber}/${Math.ceil(fileSize / PART_SIZE)}`)
      
      const uploadCommand = new UploadPartCommand({
        Bucket: R2_CONFIG.bucket,
        Key: key,
        PartNumber: partNumber,
        UploadId,
        Body: chunk
      })
      
      const { ETag } = await s3Client.send(uploadCommand)
      parts.push({ PartNumber: partNumber, ETag })
      
      offset = end
      partNumber++
    }
    
    // 完成分片上传
    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket: R2_CONFIG.bucket,
      Key: key,
      UploadId,
      MultipartUpload: { Parts: parts }
    })
    
    await s3Client.send(completeCommand)
    console.log(`✅ 上传成功: ${key} (${parts.length} 个分片)`)
  } catch (error) {
    // 如果出错，取消上传
    console.error(`❌ 上传失败: ${error.message}`)
    const abortCommand = new AbortMultipartUploadCommand({
      Bucket: R2_CONFIG.bucket,
      Key: key,
      UploadId
    })
    await s3Client.send(abortCommand)
    throw error
  }
}

/**
 * 上传文件（自动选择上传方式）
 */
async function uploadFile(filePath, key) {
  const fileSize = statSync(filePath).size
  
  if (fileSize > MULTIPART_THRESHOLD) {
    await uploadLargeFile(filePath, key)
  } else {
    await uploadSmallFile(filePath, key)
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2)
  
  if (args.length === 0) {
    console.log('使用方法:')
    console.log('  node scripts/upload-to-r2.mjs <文件或目录> [远程路径]')
    console.log('')
    console.log('示例:')
    console.log('  node scripts/upload-to-r2.mjs dist/crowvpn-macos-2.0.2-arm64.pkg')
    console.log('  node scripts/upload-to-r2.mjs dist/crowvpn-macos-2.0.2-arm64.zip')
    console.log('  node scripts/upload-to-r2.mjs dist/ *.pkg *.zip')
    console.log('')
    console.log('环境变量:')
    console.log('  R2_ACCOUNT_ID - Cloudflare R2 账户 ID')
    console.log('  R2_ACCESS_KEY_ID - R2 访问密钥 ID')
    console.log('  R2_SECRET_ACCESS_KEY - R2 密钥')
    console.log('  R2_BUCKET - R2 存储桶名称 (默认: crowvpn-updates)')
    process.exit(0)
  }
  
  const input = args[0]
  const patterns = args.slice(1)
  
  let filesToUpload = []
  
  // 如果是目录，列出所有文件
  if (statSync(input).isDirectory()) {
    const files = readdirSync(input)
    for (const file of files) {
      const fullPath = join(input, file)
      if (statSync(fullPath).isFile()) {
        // 如果指定了模式，检查是否匹配
        if (patterns.length === 0 || patterns.some(pattern => {
          // 支持通配符简单匹配
          if (pattern.includes('*')) {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'))
            return regex.test(file)
          }
          return file.includes(pattern)
        })) {
          filesToUpload.push(fullPath)
        }
      }
    }
  } else {
    filesToUpload.push(input)
  }
  
  if (filesToUpload.length === 0) {
    console.log('⚠️  没有找到要上传的文件')
    process.exit(0)
  }
  
  console.log(`🚀 准备上传 ${filesToUpload.length} 个文件到 R2`)
  console.log(`📦 Bucket: ${R2_CONFIG.bucket}`)
  console.log('')
  
  for (const filePath of filesToUpload) {
    const key = basename(filePath)
    try {
      await uploadFile(filePath, key)
    } catch (error) {
      console.error(`❌ 上传失败 ${key}: ${error.message}`)
      process.exit(1)
    }
  }
  
  console.log('')
  console.log('🎉 所有文件上传完成!')
}

// 运行主函数
main().catch(error => {
  console.error('❌ 错误:', error.message)
  process.exit(1)
})

