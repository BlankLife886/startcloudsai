import { test, expect } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL, 'Requires an isolated admin dev server')
const adminURL = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3201'

test('admin creates, edits, filters, unpublishes and deletes banners', async ({page}) => {
  let items=[]
  await page.setViewportSize({width:1440,height:900})
  await page.route('**/api/**', route => fulfillJson(route,{items:[],activeBlocks:[]}))
  await page.route('**/api/v1/admin/auth/session', route => fulfillJson(route,{admin:{id:'admin',username:'管理员',email:'admin@example.com',role:'admin'}}))
  await page.route('**/api/v1/admin/home-banners**', async route => {
    const method=route.request().method()
    if(method==='POST') { const item={...route.request().postDataJSON(),id:'banner-one'}; items.push(item); return fulfillJson(route,item) }
    if(method==='PUT') {items=[route.request().postDataJSON()];return fulfillJson(route,items[0])}
    if(method==='DELETE') {items=[];return route.fulfill({status:204})}
    return fulfillJson(route,{items})
  })
  await page.goto(`${adminURL}/admin/home-banners`)
  await page.getByRole('button',{name:'新增轮播图'}).click()
  const dialog=page.getByRole('dialog')
  await dialog.getByLabel('标题',{exact:true}).fill('首页活动')
  await dialog.getByRole('textbox',{name:'图片地址',exact:true}).fill(`${process.env.WEB_BASE_URL || 'http://127.0.0.1:3105'}/sucai/studio-cover-t2i.webp`)
  await dialog.getByLabel('副标题',{exact:true}).fill('新的创作旅程')
  await expect.poll(() => dialog.locator('.banner-editor__preview > img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  await page.screenshot({path:'../../.artifacts/admin-home-banner-editor.png'})
  await dialog.getByRole('button',{name:'保存',exact:true}).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('table').getByText('首页活动',{exact:true})).toBeVisible()
  expect(items[0].active).toBe(true)
  await page.getByRole('button',{name:'编辑',exact:true}).click()
  await dialog.getByLabel('标题',{exact:true}).fill('更新活动')
  await dialog.getByRole('button',{name:'保存',exact:true}).click()
  await expect(dialog).not.toBeVisible()
  await page.locator('.el-switch').filter({has:page.getByRole('switch',{name:'更新活动上架'})}).click()
  await expect.poll(()=>items[0]?.active).toBe(false)
  await page.getByPlaceholder('搜索轮播标题').fill('不存在')
  await expect(page.getByText('暂无轮播图')).toBeVisible()
  await page.getByPlaceholder('搜索轮播标题').clear()
  await page.screenshot({path:'../../.artifacts/admin-home-banners.png'})
  await page.getByRole('button',{name:'删除',exact:true}).click()
  await page.locator('.el-message-box').getByRole('button',{name:'删除',exact:true}).click()
  await expect.poll(()=>items.length).toBe(0)
})

test('admin can publish and clear optional banner titles and destinations', async ({ page }) => {
  let items = []
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/**', route => fulfillJson(route, { items: [], activeBlocks: [] }))
  await page.route('**/api/v1/admin/auth/session', route => fulfillJson(route, {
    admin: { id: 'admin', username: '管理员', email: 'admin@example.com', role: 'admin' },
  }))
  await page.route('**/api/v1/admin/home-banners**', route => {
    const method = route.request().method()
    if (method === 'POST' || method === 'PUT') {
      items = [{ ...route.request().postDataJSON(), id: 'untitled-banner' }]
      return fulfillJson(route, items[0])
    }
    return fulfillJson(route, { items })
  })

  await page.goto(`${adminURL}/admin/home-banners`)
  await page.getByRole('button', { name: '新增轮播图', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const imageURL = `${process.env.WEB_BASE_URL || 'http://127.0.0.1:3105'}/sucai/studio-cover-t2i.webp`
  await dialog.getByRole('textbox', { name: '图片地址', exact: true }).fill(imageURL)
  await dialog.getByLabel('标题', { exact: true }).fill('   ')
  await dialog.getByLabel('按钮文字', { exact: true }).fill('查看活动')
  await expect(dialog.locator('.banner-editor__copy')).toHaveCount(0)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(items[0]).toMatchObject({ title: '', linkUrl: '', buttonText: '查看活动', imageUrl: imageURL })
  await expect(page.getByRole('table').getByText('未命名轮播图', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await dialog.getByLabel('标题', { exact: true }).fill('临时标题')
  await dialog.getByLabel('跳转地址', { exact: true }).fill('/text-to-image')
  await expect(dialog.locator('.banner-editor__copy strong')).toHaveText('临时标题')
  await expect(dialog.locator('.banner-editor__copy > span')).toHaveText('查看活动')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await dialog.getByLabel('标题', { exact: true }).clear()
  await dialog.getByLabel('跳转地址', { exact: true }).fill('   ')
  await dialog.getByLabel('副标题', { exact: true }).fill('仅显示副标题')
  await expect(dialog.locator('.banner-editor__copy strong')).toHaveCount(0)
  await expect(dialog.locator('.banner-editor__copy > span')).toHaveCount(0)
  await expect(dialog.locator('.banner-editor__copy p')).toHaveText('仅显示副标题')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(items[0]).toMatchObject({ title: '', subtitle: '仅显示副标题', linkUrl: '', buttonText: '查看活动' })
  await page.reload()
  await expect(page.getByRole('table').getByText('未命名轮播图', { exact: true })).toBeVisible()
  await expect(page.getByRole('table').getByText('仅显示副标题', { exact: true })).toBeVisible()
})
