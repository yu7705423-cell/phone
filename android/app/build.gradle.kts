// 安卓外壳。和 ios/ 一样：一个铺满屏幕的 WebView，从网络地址载入网页，不含任何网页资源。
// 打包见 android/README.md 与 .github/workflows/android-apk.yml。
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 打包时可以用 -P 覆盖：站点地址、版本号、构建序号、包名
fun prop(name: String, fallback: String) = (project.findProperty(name) as String?)?.takeIf { it.isNotBlank() } ?: fallback
val siteUrl = prop("siteUrl", "https://yu7705423-cell.github.io/phone/")
val appVersion = prop("appVersion", "1.0.0")
val appBuild = prop("appBuild", "1").toInt()
val appId = prop("appId", "com.eira.phone")

// 正式签名用的钥匙。由打包流程从仓库的 Secret 写到这里；没有就退回调试签名（见 README 的警告）
val releaseKey = rootProject.file("release.p12")

android {
    namespace = "com.eira.phone"
    compileSdk = 35

    defaultConfig {
        applicationId = appId
        minSdk = 26
        targetSdk = 35
        versionCode = appBuild
        versionName = appVersion
        buildConfigField("String", "SITE_URL", "\"$siteUrl\"")
    }

    buildFeatures { buildConfig = true }

    signingConfigs {
        create("release") {
            if (releaseKey.exists()) {
                storeFile = releaseKey
                storeType = "pkcs12"
                storePassword = "eira-release"
                keyAlias = "eira"
                keyPassword = "eira-release"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (releaseKey.exists()) signingConfigs.getByName("release")
                            else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
