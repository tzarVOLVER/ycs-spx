'use strict';
class Renderers {
  constructor(now = Date.now) { this.now = now; this.clients = new Map(); }
  report(stage, mode, report) {
    if (!report || typeof report.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(report.id) || !['ready', 'error', 'closed'].includes(report.state) || !Number.isSafeInteger(report.revision) || report.revision < -1 || (report.message !== undefined && (typeof report.message !== 'string' || report.message.length > 300))) {
      const error = new Error('Invalid renderer report'); error.status = 400; throw error;
    }
    this.prune();
    const key = `${stage}:${mode}:${report.id}`;
    if (report.state === 'closed') this.clients.delete(key);
    else this.clients.set(key, { stage, mode, ...report, seen: this.now() });
  }
  prune() { for (const [key, client] of this.clients) if (this.now() - client.seen > 15000) this.clients.delete(key); }
  snapshot(stage, revision) {
    this.prune();
    return Object.fromEntries(['program', 'preview'].map(mode => {
      const clients = [...this.clients.values()].filter(client => client.stage === stage && client.mode === mode);
      const errors = clients.filter(client => client.state === 'error');
      return [mode, { connected: clients.length, ready: clients.filter(client => client.state === 'ready' && client.revision >= revision).length, errors: errors.map(client => client.message || 'Template rendering failed') }];
    }));
  }
}
module.exports = { Renderers };
