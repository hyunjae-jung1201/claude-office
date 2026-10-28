// 이 PC 의 팀을 다른 PC(push 원격)의 Claude Office 설정에 맞춘다. 순수 함수(원격 설정 객체 → 새 설정 객체).
const MAX_TEAMS = 7;
const KEEP = ['name', 'path', 'color', 'aliases'];

export function mergeMirror(remote, local, name) {
  const mine = (local.projects ?? []).filter((p) => !p.host && !p.ai); // Codex 같은 AI 도구 팀은 이 PC 의 hook 신호로만 채워지므로 미러하지 않는다
  // (다른 원격에 있는 팀은 그 PC 가 이미 가지고 있다) // 다른 원격에 있는 팀은 그 PC 가 이미 가지고 있다
  const own = (remote.projects ?? []).filter((p) => p.host !== name); // 원격 자체 팀(과 다른 원격의 팀)은 보존, 옛 미러 팀은 교체
  for (const p of mine) {
    if (own.some((o) => o.name === p.name)) throw new Error(`원격에 같은 이름의 자체 팀이 있습니다: ${p.name}`);
  }
  const mirrored = mine.map((p) => ({ ...Object.fromEntries(KEEP.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])), host: name }));
  const projects = [...own, ...mirrored];
  if (projects.length > MAX_TEAMS) throw new Error(`합치면 팀이 ${projects.length}개로 ${MAX_TEAMS}개를 넘습니다(원격 자체 ${own.length} + 이 PC ${mirrored.length})`);
  const remotes = (remote.remotes ?? []).filter((r) => r.name !== name);
  remotes.push({ name, push: true });
  return { ...remote, projects, remotes };
}
