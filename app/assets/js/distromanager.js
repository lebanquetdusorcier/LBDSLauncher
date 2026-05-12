const { DistributionAPI } = require('helios-core/common')
const ConfigManager = require('./configmanager')
const AuthManager = require('./authmanager')
const got = require('got')

// Old WesterosCraft url.
// exports.REMOTE_DISTRO_URL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
exports.REMOTE_DISTRO_URL = 'https://launcher-assets.lebanquetdusorcier.fr/distribution.json'
exports.EXCHANGE_URL = 'https://launcher-assets.lebanquetdusorcier.fr/api/exchange'

const SONAR_ASSET_HOST = new URL(exports.REMOTE_DISTRO_URL).host
const originalGotStream = got.stream.bind(got)

got.stream = function(url, options = {}) {
    const headers = Object.assign({}, options.headers)
    try {
        const urlHost = new URL(url).host
        if (SONAR_ASSET_HOST === urlHost && api && api.sonarTicket) {
            headers.Authorization = `Bearer ${api.sonarTicket}`
        }
    } catch (err) {
        // If the URL can't be parsed, just continue without adding auth.
    }
    return originalGotStream(url, Object.assign({}, options, { headers }))
}

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

exports.DistroAPI = api

// Add ticket exchange functionality
api.exchangeTicket = async function(authUser) {
    try {
        const response = await got.post(exports.EXCHANGE_URL, {
            json: {
                accessToken: authUser.accessToken
            },
            responseType: 'json'
        })
        const ticket = response.body.ticket
        this.sonarTicket = ticket
        return ticket
    } catch (error) {
        if (error.response && error.response.body && error.response.body.message === 'season_is_closed') {
            throw new Error('season_is_closed')
        }
        if (error.response && error.response.body && error.response.body.error) {
            throw new Error(error.response.body.error)
        }
        throw error
    }
}

api.pullRemoteAuthenticated = async function(authUser) {
    try {
        const valid = await AuthManager.validateSelected()
        if (!valid) {
            throw new Error('invalid_auth_account')
        }
        const ticket = await this.exchangeTicket(authUser)
        const response = await got.get(this.remoteUrl, {
            headers: {
                'Authorization': `Bearer ${ticket}`
            },
            responseType: 'json'
        })
        return {
            data: response.body,
            responseStatus: 'SUCCESS'
        }
    } catch (error) {
        if (error.message === 'season_is_closed') {
            throw error
        }
        this.sonarTicket = null
        return this.pullRemote() // Fallback to unauthenticated
    }
}

api.refreshDistributionOrFallbackWithAuth = async function(authUser) {
    const distro = await this._loadDistributionNullableWithAuth(authUser)
    if (distro == null) {
        DistributionAPI.log.warn('Failed to refresh distribution, falling back to current load (if exists).')
        return this.distribution
    } else {
        this.rawDistribution = distro
        this.distribution = new (require('helios-core/common').DistributionFactory.HeliosDistribution)(distro, this.commonDir, this.instanceDir)
        return this.distribution
    }
}

api._loadDistributionNullableWithAuth = async function(authUser) {
    let distro
    if (!this.devMode && authUser) {
        distro = (await this.pullRemoteAuthenticated(authUser)).data
        if (distro == null) {
            distro = await this.pullLocal()
        } else {
            await this.writeDistributionToDisk(distro)
        }
    } else {
        this.sonarTicket = null
        distro = await this._loadDistributionNullable()
    }
    return distro
}