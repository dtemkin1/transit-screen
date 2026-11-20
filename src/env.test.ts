import { describe, expect, it } from 'vitest';
import { parseFontsKit, parseWorkerUrl } from './env';

describe('WORKER_URL', () => {
  it('uses the configured URL when set', () => {
    expect(parseWorkerUrl('https://w.example')).toBe('https://w.example');
  });
  it('falls back to the local Worker when unset or empty', () => {
    expect(parseWorkerUrl(undefined)).toBe('http://localhost:8787');
    expect(parseWorkerUrl('')).toBe('http://localhost:8787');
  });
  it('fails the build on a value that is not an http(s) URL', () => {
    expect(() => parseWorkerUrl('w.example')).toThrow(/isn't a URL/);
    expect(() => parseWorkerUrl('ftp://w.example')).toThrow(/http/);
  });
});

describe('ADOBE_FONTS_KIT', () => {
  it('is optional', () => {
    expect(parseFontsKit(undefined)).toBeUndefined();
    expect(parseFontsKit('')).toBeUndefined();
    expect(parseFontsKit('abc123')).toBe('abc123');
  });
  it('fails the build on anything but a project id', () => {
    expect(() => parseFontsKit('abc.css?x=1')).toThrow(/project id/);
  });
});
