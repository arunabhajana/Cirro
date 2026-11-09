import release from './releases/1.2.0.json';
export const milestoneVersion=release.version;
export const releaseTitle=release.title;
export const releaseSummary=release.summary;
export const releaseNotes=release.groups;
export function newerVersion(current:string,previous:string){const parse=(value:string)=>value.split('-')[0].split('.').map(Number);const a=parse(current),b=parse(previous);for(let i=0;i<3;i++){if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))return false;if(a[i]!==b[i])return a[i]>b[i];}return false;}
export type ExperienceState={onboardingDone:boolean;step:number;seenVersion:string};
export function introductionFor(state:ExperienceState,current:string):'onboarding'|'whatsnew'|null {if(!state.onboardingDone)return 'onboarding';return newerVersion(current,'1.0.0')&&newerVersion(current,state.seenVersion)?'whatsnew':null;}
