import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blogIdFromUrl, isLoginUrl, isNaverHost, writeUrlFor } from '../src/naver/urls.mjs'

test('write-page URLs reveal the signed-in blog id', () => {
  assert.equal(blogIdFromUrl('https://blog.naver.com/my_blog-01?Redirect=Write&'), 'my_blog-01')
  assert.equal(blogIdFromUrl('https://blog.naver.com/PostWriteForm.naver?blogId=abc123&Redirect=Write'), 'abc123')
})

test('plain blog URL counts only after opening MyBlog.naver', () => {
  assert.equal(blogIdFromUrl('https://blog.naver.com/someoneelse'), null)
  assert.equal(blogIdFromUrl('https://blog.naver.com/mine', { fromMyBlog: true }), 'mine')
  assert.equal(blogIdFromUrl('https://m.blog.naver.com/mine', { fromMyBlog: true }), 'mine')
})

test('non-blog pages never produce an id', () => {
  for (const u of ['https://blog.naver.com/MyBlog.naver', 'https://blog.naver.com/GoBlogWrite.naver', 'https://blog.naver.com/someone/223000',
    'https://section.blog.naver.com/BlogHome.naver', 'https://evil.example/mine?Redirect=Write', 'http://blog.naver.com.evil.example/x?Redirect=Write',
    'https://nid.naver.com/nidlogin.login', 'not a url']) {
    assert.equal(blogIdFromUrl(u, { fromMyBlog: true }), null, u)
  }
})

test('custom base is honoured (used by the local smoke test)', () => {
  assert.equal(blogIdFromUrl('http://127.0.0.1:5000/tester?Redirect=Write', { base: 'http://127.0.0.1:5000' }), 'tester')
  assert.equal(blogIdFromUrl('http://127.0.0.1:5001/tester?Redirect=Write', { base: 'http://127.0.0.1:5000' }), null)
})

test('login and host checks', () => {
  assert.ok(isLoginUrl('https://nid.naver.com/nidlogin.login?mode=form'))
  assert.ok(!isLoginUrl('https://blog.naver.com/x'))
  assert.ok(isNaverHost('https://blog.naver.com/x'))
  assert.ok(!isNaverHost('http://blog.naver.com/x'))
  assert.ok(!isNaverHost('https://naver.com.evil.example/'))
})

test('write URL uses the blog id when known', () => {
  assert.equal(writeUrlFor('mine'), 'https://blog.naver.com/mine?Redirect=Write')
  assert.equal(writeUrlFor(null), 'https://blog.naver.com/GoBlogWrite.naver')
  assert.equal(writeUrlFor('../evil'), 'https://blog.naver.com/GoBlogWrite.naver')
})
