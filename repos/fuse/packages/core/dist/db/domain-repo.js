function toDomain(row) {
    return {
        id: row.id,
        name: row.name,
        contactEmail: row.contact_email,
        verified: row.verified,
        active: row.active,
        trustLevel: row.trust_level,
        dnsRecords: [],
        config: row.config,
        createdAt: row.created_at,
    };
}
function toDnsRecord(row) {
    return {
        id: row.id,
        label: row.label,
        rdata: row.rdata,
        ttl: row.ttl,
        domainId: row.domain_id,
    };
}
// ---------------------------------------------------------------------------
// Domain methods
// ---------------------------------------------------------------------------
export async function createDomain(pool, { name, contactEmail }) {
    const { rows } = await pool.query(`
    INSERT INTO domains (name, contact_email)
    VALUES ($1, $2)
    RETURNING *
    `, [name, contactEmail]);
    return toDomain(rows[0]);
}
export async function getDomainById(pool, id) {
    const { rows } = await pool.query(`SELECT * FROM domains WHERE id = $1`, [id]);
    return rows[0] ? toDomain(rows[0]) : null;
}
export async function getDomainByName(pool, name) {
    const { rows } = await pool.query(`SELECT * FROM domains WHERE name = $1`, [name]);
    return rows[0] ? toDomain(rows[0]) : null;
}
export async function updateDomain(pool, id, data) {
    const fields = [];
    const values = [];
    let idx = 1;
    if (data.name !== undefined) {
        fields.push(`name = $${idx++}`);
        values.push(data.name);
    }
    if (data.contactEmail !== undefined) {
        fields.push(`contact_email = $${idx++}`);
        values.push(data.contactEmail);
    }
    if (data.verified !== undefined) {
        fields.push(`verified = $${idx++}`);
        values.push(data.verified);
    }
    if (data.active !== undefined) {
        fields.push(`active = $${idx++}`);
        values.push(data.active);
    }
    if (data.trustLevel !== undefined) {
        fields.push(`trust_level = $${idx++}`);
        values.push(data.trustLevel);
    }
    if (data.config !== undefined) {
        fields.push(`config = $${idx++}`);
        values.push(data.config);
    }
    if (fields.length === 0) {
        return getDomainById(pool, id);
    }
    values.push(id);
    const { rows } = await pool.query(`UPDATE domains SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`, values);
    return rows[0] ? toDomain(rows[0]) : null;
}
export async function listDomains(pool) {
    const { rows } = await pool.query(`SELECT * FROM domains`);
    return rows.map(toDomain);
}
export async function deleteDomain(pool, id) {
    const { rowCount } = await pool.query(`DELETE FROM domains WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
}
export async function setTrustLevel(pool, domainId, level) {
    await pool.query(`UPDATE domains SET trust_level = $1 WHERE id = $2`, [level, domainId]);
}
// ---------------------------------------------------------------------------
// DNS record methods
// ---------------------------------------------------------------------------
export async function createDnsRecord(pool, { domainId, label, rdata, ttl }) {
    const { rows } = await pool.query(`
    INSERT INTO dns_records (domain_id, label, rdata, ttl)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (domain_id, label) DO UPDATE SET
      rdata = EXCLUDED.rdata,
      ttl = EXCLUDED.ttl
    RETURNING *
    `, [domainId, label, rdata, ttl]);
    return toDnsRecord(rows[0]);
}
export async function getDnsRecordsByDomain(pool, domainId) {
    const { rows } = await pool.query(`SELECT * FROM dns_records WHERE domain_id = $1`, [domainId]);
    return rows.map(toDnsRecord);
}
//# sourceMappingURL=domain-repo.js.map