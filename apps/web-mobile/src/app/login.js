// 登录沿用主站登录页，完成后整页跳回手机站当前地址。
export function goLogin() {
  const back = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/auth?mode=login&redirect=${encodeURIComponent(back)}`);
}
