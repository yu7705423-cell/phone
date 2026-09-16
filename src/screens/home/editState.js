import { createStore } from '../../system/store.js';

// 整理模式的状态。主界面网格和底部 Dock 都要读，所以放在共享的 store 里，
// 否则两边各存各的，图标就没法在网格与 Dock 之间互相挪。
export const editState = createStore({ edit: false, picked: null });

export const setEdit = v => editState.set({ edit: !!v, picked: null });
export const setPicked = p => editState.set({ picked: p });
export const clearPicked = () => editState.set({ picked: null });
