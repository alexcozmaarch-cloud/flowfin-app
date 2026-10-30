/**
 * FlowFin — daily Drive backup.
 * Add this as a second file (Backup.gs) in the same Apps Script project as Code.gs.
 * It uses SHEET_ID from Code.gs.
 *
 * Run startDailyBackup() once: it makes a backup now and then every night at about 03:00 Zürich time.
 * Copies go to a Drive folder called "FlowFin backups". The newest 30 are kept; older ones go to the Drive bin.
 */

var BACKUP_FOLDER_NAME = 'FlowFin backups';
var BACKUP_KEEP = 30;

function backupFolder_() {
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

function backupToDrive() {
  var folder = backupFolder_();
  var stamp = Utilities.formatDate(new Date(), 'Europe/Zurich', 'yyyy-MM-dd HHmm');
  var copy = DriveApp.getFileById(SHEET_ID).makeCopy('FlowFin backup ' + stamp, folder);

  // keep only the newest BACKUP_KEEP copies
  var files = [], it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf('FlowFin backup ') === 0) files.push(f);
  }
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });

  var result = { name: copy.getName(), url: copy.getUrl(), kept: Math.min(files.length, BACKUP_KEEP), at: new Date().toISOString() };
  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP', JSON.stringify(result));
  Logger.log('Backup saved: ' + result.name + ' (' + result.kept + ' kept)');
  return result;
}

function startDailyBackup() {
  stopDailyBackup();
  ScriptApp.newTrigger('backupToDrive').timeBased().everyDays(1).atHour(3).inTimezone('Europe/Zurich').create();
  return backupToDrive();
}

function stopDailyBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupToDrive') ScriptApp.deleteTrigger(t);
  });
}
