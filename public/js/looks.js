// 아바타의 생김새(머리색·피부색)와 변형 번호. 3D 아바타와 왼쪽 목록의 얼굴 그림이 같은 사람으로 보이게 함께 쓴다. 순수 함수.
export const HAIR = ['#2a2236', '#5a3b2a', '#c9a24a', '#1c1c1c', '#8a4b3a', '#4a4a55'];
export const SKIN = ['#f2c7a5', '#e0ac85', '#c68e67', '#f6d6bd', '#a8734f', '#edbf9a'];

const hashOf = (s) => [...String(s)].reduce((a, ch) => a + ch.charCodeAt(0), 0);

// 팀장은 팀 번호, 역할자는 'role:<id>' 글자 합(하위 에이전트 로봇은 모양이 달라 변형이 필요 없다)
export function variantFor({ team, kind, id }) {
  if (kind === 'role') return hashOf(`role:${id}`);
  if (kind === 'member') return hashOf(id);
  return team;
}
