<?php
/**
 * Sprocket Web Arena — API
 * Actions:
 *   GET  ?action=list              -> {ok, tanks:[{file,name,massT,guns}]}
 *   POST ?action=save  (multipart, field "tank")  -> {ok, file, name}
 *   GET  ?action=get&name=<slug>   -> raw blueprint JSON
 *   POST ?action=delete&name=<slug> -> {ok}
 */
header('Content-Type: application/json; charset=utf-8');

define('DATA_DIR', __DIR__ . '/data/tanks');

function fail($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(array('ok' => false, 'error' => $msg));
    exit;
}

function slugify($name) {
    $slug = strtolower(trim((string)$name));
    $slug = preg_replace('/[^a-z0-9]+/', '-', $slug);
    $slug = trim($slug, '-');
    if ($slug === '' || $slug === null) $slug = 'tank';
    if (strlen($slug) > 60) $slug = substr($slug, 0, 60);
    return $slug;
}

$action = isset($_GET['action']) ? $_GET['action'] : '';

if ($action === 'save') {
    if (!isset($_FILES['tank'])) fail('No file uploaded (expected multipart field "tank").');
    $f = $_FILES['tank'];
    if ($f['error'] !== UPLOAD_ERR_OK) fail('Upload failed (code ' . (int)$f['error'] . ').');
    if ($f['size'] > 6 * 1024 * 1024) fail('File too large (max 6 MB).');
    $raw = file_get_contents($f['tmp_name']);
    if ($raw === false) fail('Could not read uploaded file.');
    $json = json_decode($raw, true);
    if (!is_array($json) || !isset($json['header']) || !isset($json['blueprints'])) {
        fail('Not a valid Sprocket blueprint (expected JSON with "header" and "blueprints").');
    }
    $name = (isset($json['header']['name']) && $json['header']['name'] !== '')
        ? $json['header']['name'] : 'Unnamed Tank';
    $slug = slugify($name) . '-' . substr(md5($raw), 0, 6);
    if (!is_dir(DATA_DIR) && !mkdir(DATA_DIR, 0775, true)) fail('Could not create storage directory.', 500);
    if (file_put_contents(DATA_DIR . '/' . $slug . '.json', $raw) === false) fail('Could not write tank file.', 500);
    echo json_encode(array('ok' => true, 'file' => $slug, 'name' => $name));
    exit;
}

if ($action === 'list') {
    if (!is_dir(DATA_DIR)) {
        echo json_encode(array('ok' => true, 'tanks' => array()));
        exit;
    }
    $tanks = array();
    foreach (glob(DATA_DIR . '/*.json') as $path) {
        $raw = file_get_contents($path);
        $json = $raw ? json_decode($raw, true) : null;
        if (!is_array($json) || !isset($json['header'])) continue;
        $guns = 0;
        if (isset($json['blueprints']) && is_array($json['blueprints'])) {
            foreach ($json['blueprints'] as $bp) {
                if (isset($bp['type']) && $bp['type'] === 'cannon') $guns++;
            }
        }
        $tanks[] = array(
            'file'  => basename($path, '.json'),
            'name'  => isset($json['header']['name']) ? $json['header']['name'] : 'Unnamed Tank',
            'massT' => isset($json['header']['mass']) ? round($json['header']['mass'] / 1000, 1) : null,
            'guns'  => $guns
        );
    }
    usort($tanks, function ($a, $b) { return strcmp($a['name'], $b['name']); });
    echo json_encode(array('ok' => true, 'tanks' => $tanks));
    exit;
}

if ($action === 'get') {
    $file = isset($_GET['name']) ? $_GET['name'] : '';
    if (!preg_match('/^[a-z0-9-]{1,80}$/', $file)) fail('Invalid tank name.');
    $path = DATA_DIR . '/' . $file . '.json';
    if (!is_file($path)) fail('Tank not found.', 404);
    header('Content-Type: application/json; charset=utf-8');
    readfile($path);
    exit;
}

if ($action === 'delete') {
    $file = isset($_POST['name']) ? $_POST['name'] : (isset($_GET['name']) ? $_GET['name'] : '');
    if (!preg_match('/^[a-z0-9-]{1,80}$/', $file)) fail('Invalid tank name.');
    $path = DATA_DIR . '/' . $file . '.json';
    if (is_file($path)) unlink($path);
    echo json_encode(array('ok' => true));
    exit;
}

fail('Unknown action. Use action=list|save|get|delete.');