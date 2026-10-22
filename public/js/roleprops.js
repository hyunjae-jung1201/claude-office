// 검토자(역할)마다 눈에 띄는 소품. 이름만 정하고, 실제 모양은 scene.js 의 makeAvatar 가 만든다. 순수 데이터(Node 테스트 가능).
// 알 수 없는 역할은 소품 없음. 역할 파일(roles/*.md)을 추가하면 여기에도 한 줄 넣는다(테스트가 빠진 역할을 알려 준다).
export const ROLE_PROPS = {
  pm: ['tie', 'clipboard'],
  developer: ['headphones'],
  qa: ['magnifier'],
  security: ['helmet', 'badge'],
  docs: ['book'],
  performance: ['stopwatch'],
  accessibility: ['scarf', 'roundGlasses'],
  embedded: ['hardhat', 'vest'],
  copy: ['pen', 'notebook'],
  architect: ['roundGlasses', 'clipboard'],
  database: ['goggles', 'book'],
  devops: ['hardhat', 'headphones'],
  ux: ['scarf', 'pen'],
  dependency: ['badge', 'magnifier'],
  release: ['tie', 'stopwatch'],
  mlreview: ['flask', 'roundGlasses'],
  tests: ['goggles', 'flask'], // 테스터(테스트 실행) 작업 아바타
  recorder: ['notebook', 'cap'], // 기록원(작업 일지) 작업 아바타
};

export const propsFor = (roleId) => (typeof roleId === 'string' && Object.hasOwn(ROLE_PROPS, roleId) ? ROLE_PROPS[roleId] : []);
