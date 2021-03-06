
// builtin
var priv_module = require('module');
var natives = process.binding('natives');
var path = require('path');
var fs = require('fs');

// 3rd party
var detective = require('detective');

var cache = {};

// inspect the source for dependencies
function from_source(source, parent, cb) {

    var requires = detective(source);
    var result = [];

    (function next() {
        var req = requires.shift();
        if (!req) {
            return cb(null, result);
        }

        // short require name
        var id = req;

        // for now we just insert the native module into the tree
        // and mark it as 'native'
        // allow for whomever uses us to deal with natives as they wish
        var native = natives[id];
        if (native) {

            // natives are cached by id
            if (cache[id]) {
                result.push(cache[id]);
                return next();
            }

            // cache before calling compile to handle circular references
            var res = cache[id] = {
                id: id,
                native: true
            };

            result.push(res);

            from_source(native, parent, function(err, details) {
                if (err) {
                    return cb(err);
                }

                res.deps = details;
                next();
            });

            return;
        };

        var full_path = lookup_path(req, parent);

        if (!full_path) {
            return cb(new Error('unable to find module: ' + req));
        }

        var new_parent = {
            id: id,
            filename: full_path,
            paths: parent.paths
        }

        deps(full_path, new_parent, function(err, details) {
            if (err) {
                return cb(err);
            }

            result.push({
                id: id,
                filename: full_path,
                deps: details
            });

            next();
        });
    })();
}

function deps(filename, parent, cb) {

    var cached = cache[filename];
    if (cached) {
        return cb(null, cached);
    }

    fs.readFile(filename, 'utf8', function(err, content) {
        if (err) {
            return cb(err);
        }

        // must be set before the compile call to handle circular references
        var result = cache[filename] = [];

        from_source(content, parent, function(err, details) {
            if (err) {
                return cb(err);
            }

            // push onto the result set so circular references are populated
            result.push.call(result, details);

            return cb(err, details);
        });
    });
}

/// lookup the full path to our module with local name 'name'
function lookup_path(name, parent) {
    var resolved_module = priv_module.Module._resolveLookupPaths(name, parent);
    var paths = resolved_module[1];

    return priv_module.Module._findPath(name, paths);
}

/// process filename and callback with tree of dependencies
/// the tree does have circular references when a child requires a parent
module.exports = function(filename, cb) {

    var resolve = priv_module.Module._resolveLookupPaths(filename, null);
    if (!resolve || resolve.length !== 2) {
        return cb(new Error('unable to resolve paths for: ' + filename));
    }

    // entry parent specifies the base node modules path
    var entry_parent = {
        id: filename,
        filename: filename,
        paths: resolve[1]
    }

    deps(filename, entry_parent, function(err, details) {
        // clear the global cache
        cache = {};
        cb(err, details);
    });
}

