#!/usr/bin/env node
// 조사용: hook stdin JSON을 CAPTURE_FILE(기본 /tmp/claude-office-capture.jsonl)에 한 줄씩 추가한다.
import { appendFileSync } from 'node:fs';

const file = process.env.CAPTURE_FILE || '/tmp/claude-office-capture.jsonl';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  try {
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), payload: JSON.parse(input) }) + '\n');
  } catch {
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), raw: input }) + '\n');
  }
  process.exit(0);
});
