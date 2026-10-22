// 요약기·말풍선·로그에 들어가기 전에 비밀값을 가린다.
// pass/auth는 뒤에 글자가 이어지면(author 등) 제외한다
const KEY_WORDS = '(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|private[_-]?key|pass(?![a-zA-Z])|auth(?![a-zA-Z]))';

// 식별자만으로 이루어진 완전한 함수 호출(getSecret(name), path.join(dir, name)). 리터럴·숫자 인자가 있으면 해당하지 않는다.
const IDENT = '[A-Za-z_$][\\w$]*';
// 여는 괄호 뒤 공백(\\s*) 하나만 두고, 인자 목록은 공백으로 끝나지 않게 해서 공백 반복이 겹치지 않도록 한다(정규식 폭주 방지).
const SAFE_CALL = `${IDENT}(?:\\.${IDENT})*\\(\\s*(?:${IDENT}(?:\\.${IDENT})*(?:\\s*,\\s*${IDENT}(?:\\.${IDENT})*)*\\s*)?\\);?`;
const SAFE_CALL_ONLY = new RegExp(`^${SAFE_CALL}$`);

const RULES = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '***'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '***'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '***'],
  [/\bBearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer ***'],
  [/\bBasic\s+[A-Za-z0-9+\/]{8,}={0,2}/g, 'Basic ***'],
  // curl -u user:password
  [/(\s-u\s+)[^\s:]+:\S+/g, '$1***'],
  // URL에 박힌 user:password@host(비밀번호에 / 포함 가능), :password@host, token@host
  [/((?<![A-Za-z0-9+.-])[A-Za-z0-9+.-]*:\/\/)(?:[^:\/\s@]*:[^@\s]+|[^\/\s@:]+)@/g, '$1***@'],
  // KEY=값, KEY: 값, "key": "값" (GITHUB_TOKEN, my_password 같은 접두사 포함)
  // 값이 식별자만으로 된 함수 호출이면 코드이므로 가리지 않는다. 따옴표 값, 괄호가 섞인 그 밖의 값(줄 끝까지), 일반 값은 가린다.
  [new RegExp(`((?<![A-Za-z0-9_-])[A-Za-z0-9_-]*${KEY_WORDS}[A-Za-z0-9_-]*["']?\\s*[=:]\\s*)(${SAFE_CALL}(?=\\s|$)|"[^"\\n]*"?|'[^'\\n]*'?|[^\\s"'(]*\\([^\\n]*|[^\\s"']+)`, 'gi'), (m, key, value) => (SAFE_CALL_ONLY.test(value) ? m : `${key}***`)],
  // --password 값, --token 값 (공백 구분 플래그)
  [new RegExp(`(--?${KEY_WORDS}\\s+)["']?[^\\s"']+["']?`, 'gi'), '$1***'],
  // mysql -pVALUE (값이 붙은 형태만, `mkdir -p dir` 은 그대로)
  [/(\s-p)(?!\s)[^\s-]\S*/g, '$1***'],
  // 20자 이상이면서 숫자를 포함하는 긴 덩어리(해시, base64 키)
  [/(?<![A-Za-z0-9+_-])(?=[A-Za-z0-9+_-]*\d)[A-Za-z0-9+_-]{20,}\b/g, '***'],
];

const SENSITIVE_NAME =
  /^(?:\.env(?:\.[\w-]+)?|\.netrc|\.npmrc|\.pypirc|[\w.-]*\.(?:pem|key|p12|pfx|jks)|id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?|[\w.-]*(?:credentials|secret)[\w.-]*|[\w.-]*_key)$/i;
const SENSITIVE_DIRS = new Set(['.ssh', '.aws', '.gnupg']);

// 이 경로가 비밀값을 담을 만한 파일/폴더인가(.env, 키, .ssh/ 아래 등). 마지막 조각 또는 폴더 조각으로 판단한다.
export function isSensitivePath(path) {
  const parts = String(path).split(/[\/=]/);
  return SENSITIVE_NAME.test(parts.at(-1)) || parts.some((p) => SENSITIVE_DIRS.has(p.toLowerCase()));
}

// 파일·경로처럼 생긴 토큰만 본다(코드의 식별자 clientSecret, config.secret 같은 것은 건드리지 않는다)
const FILE_EXT = /\.(?:env|ya?ml|json|pem|key|p12|pfx|jks|crt|cer|der|txt|conf|cfg|ini|toml|properties|xml|kdbx|npmrc|netrc|pypirc)$/i;
const looksLikePath = (tok) => tok.includes('/') || tok.startsWith('.') || /^id_/i.test(tok) || FILE_EXT.test(tok);

// 공백 단위 토큰마다 민감한 경로인지 본다. 선형 시간.
function maskPaths(text) {
  return text.replace(/[^\s"']+/g, (tok) => (looksLikePath(tok) && isSensitivePath(tok) ? '설정 파일' : tok));
}

export function maskSecrets(text) {
  let out = String(text);
  for (const [re, to] of RULES) out = out.replace(re, to);
  return maskPaths(out);
}
