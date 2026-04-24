// types/library-patches.d.ts
import 'ge-smarthq';

declare module 'ge-smarthq' {
  export interface SendCommandSuccessResponse {
    correlationId: string;
    timestamp: string;
    outcome: string;
    success: boolean;
  }
}