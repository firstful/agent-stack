import type { Pool } from "pg";
import type { DomainConfig, DnsRecord, Domain as DomainType, TrustLevel } from "../types/domain.js";
interface FullDnsRecord extends DnsRecord {
    id: string;
}
export declare function createDomain(pool: Pool, { name, contactEmail }: {
    name: string;
    contactEmail: string;
}): Promise<DomainType>;
export declare function getDomainById(pool: Pool, id: string): Promise<DomainType | null>;
export declare function getDomainByName(pool: Pool, name: string): Promise<DomainType | null>;
export declare function updateDomain(pool: Pool, id: string, data: Partial<{
    name: string;
    contactEmail: string;
    verified: boolean;
    active: boolean;
    trustLevel: TrustLevel;
    config: DomainConfig;
}>): Promise<DomainType | null>;
export declare function listDomains(pool: Pool): Promise<DomainType[]>;
export declare function deleteDomain(pool: Pool, id: string): Promise<boolean>;
export declare function setTrustLevel(pool: Pool, domainId: string, level: TrustLevel): Promise<void>;
export declare function createDnsRecord(pool: Pool, { domainId, label, rdata, ttl }: {
    domainId: string;
    label: string;
    rdata: string[];
    ttl: number;
}): Promise<FullDnsRecord>;
export declare function getDnsRecordsByDomain(pool: Pool, domainId: string): Promise<FullDnsRecord[]>;
export {};
//# sourceMappingURL=domain-repo.d.ts.map