import { initializeApp } from 'firebase-admin/app';
initializeApp();

export { createOrganization } from './auth/createOrganization';
export { inviteUser } from './auth/inviteUser';
export { getOrgUsers } from './auth/getOrgUsers';
export { changeUserRole } from './auth/changeUserRole';
export { removeUser } from './auth/removeUser';
export { pcoOAuthCallback, pcoOAuthStart } from './pco/oauth';
export { getPcoResources } from './pco/resources';
export { triggerPcoSync } from './pco/sync';
export { scheduledPcoSync } from './pco/scheduledSync';
export { dispatchDoorCommands, processPendingDoorCommands } from './scheduler/dispatcher';
export { updatePlatformConfig, getPlatformConfigCallable } from './admin/platformConfig';
export { getPlatformOverview, adminDeleteUser, adminDeleteTenant, adminSetUserSuperAdmin } from './admin/platformAdmin';
export { testPcoConnection, testUnifiConnection } from './config/testConnections';
export { generateAgentToken, registerAgentWithToken } from './agent/agentRegistration';
export { syncUnifiDoors } from './unifi/doors';
export { syncUnifiSchedules, saveUnifiSchedule, deleteUnifiSchedule } from './unifi/schedules';
export { syncUnifiVisitors, saveUnifiVisitor, deleteUnifiVisitor } from './unifi/visitors';
export { syncUnifiAccessPolicies, saveUnifiAccessPolicy, deleteUnifiAccessPolicy } from './unifi/policies';
export { triggerUserSync, getPcoLists } from './pco/userSync';
export { syncUnifiAccessLogs } from './unifi/accessLogs';
export { publishAgentRelease, getLatestAgentRelease, listAgentReleases, uploadAgentRelease, downloadAgentRelease } from './agent/releases';
export { getPcoCampusesAndLocations, assignDoorsToCampusLocation } from './pco/campuses';

