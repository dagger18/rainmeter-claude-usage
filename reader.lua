local filePath = os.getenv("APPDATA") .. "\\Claude\\usage_data.json"

function Initialize()
    LoadFile()
end

function Update()
    LoadFile()
    return ""
end

function LoadFile()
    local f = io.open(filePath, "r")
    if not f then return end
    local raw = f:read("*all")
    f:close()

    local function getNum(key)
        local v = raw:match('"' .. key .. '"%s*:%s*([0-9]+)')
        return v or "0"
    end
    local function getStr(key)
        local v = raw:match('"' .. key .. '"%s*:%s*"([^"]*)"')
        return v or ""
    end

    local ts = tonumber(getNum('last_updated_ts')) or 0
    local label = "--"
    if ts > 0 then
        local diff = os.time() - ts
        local mins = math.floor(diff / 60)
        if mins < 1 then
            label = "just now"
        elseif mins == 1 then
            label = "1 min ago"
        else
            label = mins .. " min ago"
        end
    end

    SKIN:Bang('!SetVariable', 'SessionPct',   getNum('session_pct'))
    SKIN:Bang('!SetVariable', 'WeeklyPct',    getNum('weekly_pct'))
    SKIN:Bang('!SetVariable', 'SessionReset', getStr('session_reset_label'))
    SKIN:Bang('!SetVariable', 'WeeklyReset',  getStr('weekly_reset_label'))
    SKIN:Bang('!SetVariable', 'LastUpdated',  label)
    SKIN:Bang('!SetVariable', 'ErrMsg',       getStr('error'))
end
