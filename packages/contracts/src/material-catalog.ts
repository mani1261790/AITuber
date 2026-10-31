export interface MaterialCatalog {
  revision: number;
  groups: {id: string; label: string}[];
  entries: {id: string; groupId: string; title: string; previous: boolean}[];
}
export const defaultMaterialGroups = [
  {id:'festival',label:'学園祭デモ'}, {id:'ai',label:'AI・ローカルLLM'},
  {id:'statistics',label:'多変量モデル'}, {id:'other',label:'その他'},
];
