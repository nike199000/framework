// Copyright 2012-2018 (c) Peter Širka <petersirka@gmail.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

/**
 * @module FrameworkDebug
 * @version 3.0.0
 */

const Path = require('path');
const Fs = require('fs');
const debugging = process.argv.indexOf('debugging') !== -1;
const isWindows = require('os').platform().substring(0, 3).toLowerCase() === 'win';

var first = process.argv.indexOf('restart') === -1;
var options = null;

module.exports = function(opt) {
	options = opt;
	// options.ip = '127.0.0.1';
	// options.port = parseInt(process.argv[2]);
	// options.config = { name: 'Total.js' };
	// options.https = { key: Fs.readFileSync('keys/agent2-key.pem'), cert: Fs.readFileSync('keys/agent2-cert.pem')};
	// options.sleep = 3000;
	// options.inspector = 9229;
	// options.debugger = 40894;
	// options.watch = ['adminer'];
};

process.on('uncaughtException', e => e.toString().indexOf('ESRCH') == -1 && console.log(e));
process.title = 'total: debug';

function runapp() {

	!options && (options = {});
	require('total.js');

	var port = parseInt(process.argv[process.argv.length - 1]);

	if (!isNaN(port))
		options.port = port;

	if (port > 0 && !options.port)
		options.port = port || 8000;

	if (options.https)
		F.https('debug', options);
	else
		F.http('debug', options);

	if (first)
		F.emit('debug-start');
	else
		F.emit('debug-restart');
}

function runwatching() {

	!options && (options = {});
	require('./index');

	const FILENAME = U.getName(process.argv[1]);
	const directory = process.cwd();
	const VERSION = F.version_header;
	const TIME = 2000;
	const REG_CONFIGS = /configs\//g;
	const REG_FILES = /config-debug|config-release|config|versions|workflows|sitemap|dependencies|\.js$|\.resource$/i;
	const REG_THEMES = /\/themes\//i;
	const REG_COMPONENTS = /components\/.*?\.html/i;
	const REG_THEMES_INDEX = /themes(\/|\\)?[a-z0-9_.-]+(\/|\\)?index\.js$/i;
	const REG_EXTENSION = /\.(js|resource|package|bundle)$/i;

	function copyFile(oldname, newname, callback) {
		var writer = Fs.createWriteStream(newname);
		callback && writer.on('finish', callback);
		Fs.createReadStream(oldname).pipe(writer);
	}

	function app() {

		F.$configure_configs();
		F.directory = directory;

		const fork = require('child_process').fork;
		const directories = [
			U.combine(F.config['directory-components']),
			U.combine(F.config['directory-controllers']),
			U.combine(F.config['directory-definitions']),
			U.combine(F.config['directory-isomorphic']),
			U.combine(F.config['directory-modules']),
			U.combine(F.config['directory-models']),
			U.combine(F.config['directory-schemas']),
			U.combine(F.config['directory-resources']),
			U.combine(F.config['directory-source']),
			U.combine(F.config['directory-workers']),
			U.combine(F.config['directory-packages']),
			U.combine(F.config['directory-themes']),
			U.combine(F.config['directory-configs']),
			U.combine(F.config['directory-bundles']),
			U.combine('/startup/')
		];

		const SRC = U.combine(F.config['directory-src']);
		const prefix = '----------------> ';

		options.watch && options.watch.forEach(function(item) {
			if (item[0] === '/')
				item = item.substring(1);
			if (item[item.length - 1] === '/')
				item = item.substring(0, item.length - 1);
			directories.push(U.combine(item));
		});

		var files = {};
		var force = false;
		var changes = [];
		var app = null;
		var status = 0;
		var pid = '';
		var isLoaded = false;
		var isSkip = false;
		var pidIncrease;
		var speed = TIME;
		var isBUNDLE = false;
		var blacklist = {};

		blacklist['/debug.pid'] = 1;
		blacklist['/debug.js'] = 1;
		blacklist['/bundle.json'] = 1;
		blacklist['/package.json'] = 1;
		blacklist['/readme.md'] = 1;

		try {
			Fs.statSync(F.path.root(F.config['directory-bundles']));
			isBUNDLE = true;
		} catch(e) {}

		if (isBUNDLE) {
			directories.push(U.combine(F.config['directory-public']));
			directories.push(U.combine(F.config['directory-views']));
		}

		function onFilter(path, isDirectory) {
			if (isBUNDLE) {
				if (isDirectory)
					return SRC !== path;
				var p = path.substring(directory.length);
				return !blacklist[p];
			}
			return isDirectory && REG_THEMES.test(path) ? REG_THEMES_INDEX.test(path) : isDirectory ? true : REG_EXTENSION.test(path) || REG_COMPONENTS.test(path) || REG_CONFIGS.test(path);
		}

		function onIncrease(clear) {

			if (clear) {
				clearTimeout(pidIncrease);
				speed = TIME;
			}

			pidIncrease = setTimeout(function() {
				speed += TIME;
				if (speed > 4000)
					speed = 4000;
				onIncrease();
			}, 120000);
		}

		function onComplete(f) {

			Fs.readdir(directory, function(err, arr) {

				var length = arr.length;
				for (var i = 0; i < length; i++) {
					var name = arr[i];
					name !== FILENAME && REG_FILES.test(name) && f.push(name);
				}

				length = f.length;

				for (var i = 0; i < length; i++) {
					var name = f[i];
					if (files[name] === undefined)
						files[name] = isLoaded ? 0 : null;
				}

				refresh();
			});
		}

		function isViewPublic(filename) {
			var fn = filename.substring(directory.length);
			var dir = fn.substring(0, fn.indexOf('/', 1) + 1);
			return F.config['directory-views'] === dir || F.config['directory-public'] === dir ? fn : '';
		}

		function refresh() {
			Object.keys(files).wait(function(filename, next) {
				Fs.stat(filename, function(err, stat) {

					var stamp = '--- # --- [ ' + new Date().format('yyyy-MM-dd HH:mm:ss') + ' ] ';

					if (err) {
						delete files[filename];
						var tmp = isViewPublic(filename);
						var log = stamp.replace('#', 'REM') + prefix + normalize(filename.replace(directory, ''));
						if (tmp) {
							Fs.unlinkSync(Path.join(SRC, tmp));
							console.log(log);
						} else {
							changes.push(log);
							force = true;
						}
					} else {
						var ticks = stat.mtime.getTime();
						if (files[filename] != null && files[filename] !== ticks) {

							var log = stamp.replace('#', files[filename] === 0 ? 'ADD' : 'UPD') + prefix + normalize(filename.replace(directory, ''));

							if (files[filename]) {
								var tmp = isViewPublic(filename);
								if (tmp) {
									copyFile(filename, Path.join(SRC, tmp));
									files[filename] = ticks;
									console.log(log);
									next();
									return;
								}
							}

							changes.push(log);
							force = true;
						}
						files[filename] = ticks;
					}

					next();
				});
			}, function() {

				isLoaded = true;
				setTimeout(refresh_directory, speed);
				onIncrease();

				if (status !== 1 || !force)
					return;

				onIncrease(true);
				restart();

				var length = changes.length;
				for (var i = 0; i < length; i++)
					console.log(changes[i]);

				changes = [];
				force = false;
			}, 3);
		}

		function refresh_directory() {
			U.ls(directories, onComplete, onFilter);
		}

		function restart() {

			if (app !== null) {
				try
				{
					isSkip = true;
					process.kill(app.pid);
				} catch (err) {}
				app = null;
			}

			var arr = process.argv;
			var port = arr.pop();

			if (process.execArgv.indexOf('--debug') !== -1 || options.debugger) {
				var key = '--debug=' + (options.debugger || 40894);
				process.execArgv.indexOf(key) === -1 && process.execArgv.push(key);
			}

			if (process.execArgv.indexOf('--inspect') !== -1 || options.inspector) {
				var key = '--inspect=' + (options.inspector || 9229);
				process.execArgv.indexOf(key) === -1 && process.execArgv.push(key);
			}

			if (first)
				first = false;
			else
				arr.push('restart');

			arr.push('debugging');
			arr.push(port);

			app = fork(Path.join(directory, FILENAME), arr);

			app.on('message', function(msg) {
				switch (msg) {
					case 'total:eaddrinuse':
						process.exit(1);
						break;
					case 'total:ready':
						if (status === 0) {
							app.send('total:debug');
							status = 1;
						}
						break;
				}
			});

			app.on('exit', function() {

				// checks unexpected exit
				if (isSkip === false) {
					app = null;
					process.exit();
					return;
				}

				isSkip = false;
				if (status === 255)
					app = null;
			});
		}

		process.on('SIGTERM', end);
		process.on('SIGINT', end);
		process.on('exit', end);

		function end() {

			if (arguments.callee.isEnd)
				return;

			arguments.callee.isEnd = true;
			Fs.unlink(pid, noop);

			if (app === null) {
				process.exit(0);
				return;
			}

			isSkip = true;
			process.kill(app.pid);
			app = null;
			process.exit(0);
		}

		function noop() {}

		if (process.pid > 0) {

			console.log(prefix.substring(8) + 'DEBUG PID: ' + process.pid + ' (v' + VERSION + ')');

			pid = Path.join(directory, 'debug.pid');
			Fs.writeFileSync(pid, process.pid);

			setInterval(function() {
				Fs.exists(pid, function(e) {

					if (e)
						return;

					Fs.unlink(pid, noop);

					if (app !== null) {
						isSkip = true;
						process.kill(app.pid);
					}

					process.exit(0);
				});

			}, 2000);
		}

		restart();
		refresh_directory();
	}

	var filename = Path.join(directory, 'debug.pid');
	if (Fs.existsSync(filename)) {
		Fs.unlinkSync(filename);
		setTimeout(app, 2500);
	} else
		app();
}

function normalize(path) {
	return isWindows ? path.replace(/\\/g, '/') : path;
}

if (debugging)
	setImmediate(runapp);
else
	setImmediate(runwatching);
