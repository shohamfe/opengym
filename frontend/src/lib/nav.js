// Lets non-component modules (sheet flows) navigate. App registers the router's navigate.
let _nav = () => {}
export const setNav = fn => { _nav = fn }
export const nav = to => _nav(to)
// Back to wherever the user came from; a refresh/deep link has no in-app history, so go to `fallback`.
export const back = fallback => (window.history.state?.idx > 0 ? _nav(-1) : _nav(fallback))
