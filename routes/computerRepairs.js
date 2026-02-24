const express = require('express');
const router = express.Router();
const { db, generateId, getAll, getById, getByColumn, insert, update, updateField, remove, clearTable, count } = require('../db/database');
const { sendEmail } = require('../services/emailService');

// ============================================
// COMPUTER REPAIR AI — HELPER FUNCTIONS
// ============================================

function getImpactLabel(impact) {
  var labels = {
    '1': 'District',
    '2': 'Multiple Schools/Departments',
    '3': 'Single School/Department',
    '4': 'Individual'
  };
  return labels[impact] || 'Individual';
}

/**
 * Calculate text similarity (Jaccard-like)
 */
function calculateSimilarity(text1, text2) {
  var words1 = text1.split(/\s+/).filter(function(w) { return w.length > 2; });
  var words2 = text2.split(/\s+/).filter(function(w) { return w.length > 2; });

  if (words1.length === 0 || words2.length === 0) return 0;

  var set1 = {};
  var set2 = {};
  words1.forEach(function(w) { set1[w] = true; });
  words2.forEach(function(w) { set2[w] = true; });

  var intersection = 0;
  Object.keys(set1).forEach(function(w) {
    if (set2[w]) intersection++;
  });

  var union = Object.keys(set1).length + Object.keys(set2).length - intersection;
  return union > 0 ? intersection / union : 0;
}

// ============================================
// COMPUTER REPAIR AI — RULE-BASED CLASSIFICATION
// ============================================

/**
 * Enhanced AI-powered classification for computer repair issues
 */
function classifyCrByRules(text, rawText) {
  var result = {
    category: '',
    subcategory: '',
    channel: 'self-service',
    impact: '4',
    impactLabel: 'Individual',
    priority: 'Medium',
    improvedDescription: '',
    troubleshooting: '',
    estimatedTime: '',
    confidence: 0.5,
    source: 'ai-rules'
  };

  // Enhanced hardware rules with professional descriptions and troubleshooting
  var hardwareRules = [
    {
      keywords: ['screen', 'display', 'monitor', 'lcd', 'cracked screen', 'broken screen', 'black screen', 'flickering', 'lines on screen', 'dead pixels'],
      subcategory: 'Screen/Display',
      priority: 'High',
      estimatedTime: '1-3 days',
      getDescription: function(text, raw) {
        if (text.indexOf('cracked') !== -1 || text.indexOf('broken') !== -1) {
          return 'HARDWARE DAMAGE: Display panel physically damaged. User reports cracked/broken screen. Device requires LCD/panel replacement. DO NOT attempt to use device - glass shards may cause injury. Schedule for hardware repair.';
        } else if (text.indexOf('black') !== -1 || text.indexOf('blank') !== -1) {
          return 'DISPLAY FAILURE: Screen not producing image output. Possible causes: backlight failure, display cable disconnection, GPU issue, or panel failure. Requires diagnostic testing to determine if software or hardware fault.';
        } else if (text.indexOf('flickering') !== -1 || text.indexOf('flashing') !== -1) {
          return 'DISPLAY INSTABILITY: Screen exhibiting intermittent flickering/flashing. May indicate failing display cable, backlight inverter issue, or GPU driver problem. Start with driver update before hardware diagnosis.';
        }
        return 'DISPLAY ISSUE: User reports visual abnormality with screen output. Requires hands-on inspection to diagnose. Check display connections, run graphics diagnostics, and verify driver status.';
      },
      getTroubleshooting: function(text) {
        if (text.indexOf('black') !== -1) {
          return '1) Connect external monitor to test GPU output. 2) Perform hard reset (hold power 30 sec). 3) Boot to safe mode if possible. 4) Check display brightness settings.';
        }
        return '1) Update graphics drivers. 2) Check display cable connections. 3) Test with external monitor. 4) Run built-in display diagnostics.';
      }
    },
    {
      keywords: ['keyboard', 'keys', 'typing', 'stuck key', 'key not working', 'missing key', 'keys dont work', 'cant type'],
      subcategory: 'Keyboard',
      priority: 'Medium',
      estimatedTime: '1-2 days',
      getDescription: function(text, raw) {
        if (text.indexOf('stuck') !== -1 || text.indexOf('sticky') !== -1) {
          return 'KEYBOARD MALFUNCTION: Key(s) physically stuck or sticky. Likely cause: debris/liquid contamination under keycap. Requires keyboard cleaning or replacement depending on severity.';
        } else if (text.indexOf('missing') !== -1) {
          return 'KEYBOARD DAMAGE: Keycap(s) physically missing from keyboard. May affect typing functionality. Replacement keycaps or full keyboard replacement may be required.';
        } else if (text.indexOf('all') !== -1 || text.indexOf('none') !== -1 || text.indexOf('whole') !== -1) {
          return 'KEYBOARD FAILURE: Complete keyboard non-responsive. Possible causes: keyboard flex cable disconnection, motherboard keyboard controller failure, or driver issue. Test with external USB keyboard to isolate.';
        }
        return 'KEYBOARD ISSUE: User reports key input malfunction. Specific keys may be non-responsive or behaving incorrectly. Diagnosis required to determine if hardware replacement needed.';
      },
      getTroubleshooting: function(text) {
        return '1) Test with external USB keyboard. 2) Check keyboard in BIOS/UEFI (eliminates driver issues). 3) Reinstall keyboard driver. 4) Inspect for physical debris under keys.';
      }
    },
    {
      keywords: ['trackpad', 'touchpad', 'mouse', 'cursor', 'click', 'pointer', 'jumping cursor', 'cursor moving'],
      subcategory: 'Trackpad/Mouse',
      priority: 'Medium',
      estimatedTime: '1-2 days',
      getDescription: function(text, raw) {
        if (text.indexOf('jumping') !== -1 || text.indexOf('erratic') !== -1 || text.indexOf('moving on its own') !== -1) {
          return 'INPUT DEVICE MALFUNCTION: Cursor exhibiting erratic/uncontrolled movement. Possible causes: trackpad sensitivity issue, driver conflict, electrical interference, or hardware failure. May also indicate palm rejection not functioning.';
        } else if (text.indexOf('click') !== -1) {
          return 'TRACKPAD CLICK FAILURE: Physical click mechanism not registering or registering incorrectly. May be hardware failure of click mechanism or trackpad surface damage requiring replacement.';
        }
        return 'POINTING DEVICE ISSUE: User reports trackpad/mouse input problems. Cursor not responding or behaving unexpectedly. Requires driver verification and hardware testing.';
      },
      getTroubleshooting: function(text) {
        return '1) Test with external USB mouse. 2) Update/reinstall trackpad drivers. 3) Check trackpad settings (sensitivity, palm rejection). 4) Clean trackpad surface. 5) Disable and re-enable in Device Manager.';
      }
    },
    {
      keywords: ['battery', 'charge', 'not charging', 'dies quickly', 'power drain', 'draining fast', 'battery swollen', 'bulging'],
      subcategory: 'Battery',
      priority: 'High',
      estimatedTime: '1-2 days',
      getDescription: function(text, raw) {
        if (text.indexOf('swollen') !== -1 || text.indexOf('bulging') !== -1 || text.indexOf('expanded') !== -1) {
          return 'CRITICAL SAFETY ISSUE: Battery exhibiting physical swelling/expansion. THIS IS A FIRE HAZARD. Device should NOT be used or charged. Battery requires immediate replacement. Do not puncture or dispose of in regular trash.';
        } else if (text.indexOf('not charging') !== -1 || text.indexOf('wont charge') !== -1) {
          return 'CHARGING SYSTEM FAILURE: Device not accepting charge from AC adapter. Possible causes: faulty charger, damaged charging port, battery failure, or charging circuit issue. Requires systematic diagnosis.';
        } else if (text.indexOf('dies') !== -1 || text.indexOf('drain') !== -1 || text.indexOf('quickly') !== -1) {
          return 'BATTERY DEGRADATION: Battery not holding charge as expected. Battery health may be diminished (normal wear) or system may have excessive power draw. Run battery diagnostics to determine replacement necessity.';
        }
        return 'POWER/BATTERY ISSUE: User reports battery or charging-related problem. Requires charger testing, battery health check, and charging port inspection.';
      },
      getTroubleshooting: function(text) {
        if (text.indexOf('swollen') !== -1 || text.indexOf('bulging') !== -1) {
          return 'STOP USING DEVICE IMMEDIATELY. Do not charge. Contact IT for safe battery removal and disposal. This is a fire hazard.';
        }
        return '1) Test with known-good charger. 2) Inspect charging port for debris/damage. 3) Run battery health diagnostics. 4) Check power settings for battery drain causes. 5) Review background processes.';
      }
    },
    {
      keywords: ['charging port', 'charger', 'plug', 'power port', 'usb-c charge', 'power adapter', 'loose charger', 'charger falls out'],
      subcategory: 'Charging Port',
      priority: 'High',
      estimatedTime: '2-5 days',
      getDescription: function(text, raw) {
        if (text.indexOf('loose') !== -1 || text.indexOf('falls out') !== -1 || text.indexOf('wiggles') !== -1) {
          return 'CHARGING PORT DAMAGE: Physical damage to charging port causing intermittent or no connection. Port may be worn, bent, or have broken solder joints. Requires motherboard-level repair or port replacement.';
        }
        return 'CHARGING PORT ISSUE: User reports problems with power connection. Port may have debris, physical damage, or internal failure. Inspection and possible component-level repair required.';
      },
      getTroubleshooting: function(text) {
        return '1) Inspect port for debris (use compressed air carefully). 2) Test with multiple known-good chargers. 3) Check for bent pins or physical damage. 4) Test different angles - if intermittent, port likely damaged.';
      }
    },
    {
      keywords: ['speaker', 'audio', 'sound', 'no sound', 'volume', 'headphone jack', 'crackling', 'distorted sound', 'quiet'],
      subcategory: 'Speakers/Audio',
      priority: 'Low',
      estimatedTime: '1-2 days',
      getDescription: function(text, raw) {
        if (text.indexOf('no sound') !== -1 || text.indexOf('no audio') !== -1) {
          return 'AUDIO OUTPUT FAILURE: No sound output from device speakers. Possible causes: muted system, audio driver issue, speaker hardware failure, or audio jack sensing stuck. Software troubleshooting should precede hardware diagnosis.';
        } else if (text.indexOf('crackling') !== -1 || text.indexOf('distorted') !== -1 || text.indexOf('static') !== -1) {
          return 'AUDIO QUALITY DEGRADATION: Speaker output distorted or contains unwanted noise. May indicate speaker cone damage, loose connection, or audio driver/codec issue.';
        }
        return 'AUDIO SYSTEM ISSUE: User reports problems with sound output or audio functionality. Requires driver verification, hardware testing, and connection checks.';
      },
      getTroubleshooting: function(text) {
        return '1) Check volume and mute settings. 2) Test with headphones (isolates speaker vs. system issue). 3) Update audio drivers. 4) Run audio troubleshooter. 5) Check audio jack for debris or stuck detection.';
      }
    },
    {
      keywords: ['camera', 'webcam', 'video call', 'camera not working', 'teams camera', 'zoom camera', 'black camera', 'camera in use'],
      subcategory: 'Camera/Webcam',
      priority: 'Medium',
      estimatedTime: '1 day',
      getDescription: function(text, raw) {
        if (text.indexOf('black') !== -1 || text.indexOf('blank') !== -1) {
          return 'WEBCAM FAILURE: Camera showing black/blank image. Possible causes: privacy shutter closed, camera disabled in BIOS, driver issue, or hardware failure. Check physical privacy switch first.';
        } else if (text.indexOf('in use') !== -1 || text.indexOf('another app') !== -1) {
          return 'CAMERA ACCESS CONFLICT: Camera reported as in use by another application. Likely software conflict - another application holding camera resource. Requires identification and closure of conflicting process.';
        }
        return 'WEBCAM ISSUE: User reports camera not functioning for video calls. Requires privacy switch check, driver verification, and application permissions review.';
      },
      getTroubleshooting: function(text) {
        return '1) Check physical camera privacy shutter/switch. 2) Verify camera not disabled in BIOS. 3) Check Windows camera privacy settings. 4) Update camera driver. 5) Test in Camera app before video conference apps.';
      }
    },
    {
      keywords: ["won't turn on", 'not turning on', 'wont power', 'dead computer', 'no power', 'power button', 'completely dead', 'nothing happens'],
      subcategory: 'Power/Motherboard',
      priority: 'Critical',
      estimatedTime: '2-5 days',
      getDescription: function(text, raw) {
        return 'NO POWER CONDITION: Device exhibits no response when power button pressed. No lights, sounds, or fan activity. Possible causes: depleted battery, faulty AC adapter, power button failure, or motherboard failure. Systematic diagnosis required starting with power source verification.';
      },
      getTroubleshooting: function(text) {
        return '1) Verify AC adapter connected and LED lit. 2) Try different outlet. 3) Perform battery reset (remove battery if possible, hold power 30 sec). 4) Try bare-minimum boot (AC only, no battery, no peripherals). 5) Listen for any fan spin or beep codes.';
      }
    },
    {
      keywords: ['fan', 'overheating', 'hot', 'thermal', 'loud fan', 'burns', 'shuts down randomly', 'thermal throttling'],
      subcategory: 'Cooling/Thermal',
      priority: 'High',
      estimatedTime: '1-3 days',
      getDescription: function(text, raw) {
        if (text.indexOf('shuts down') !== -1 || text.indexOf('turns off') !== -1) {
          return 'THERMAL SHUTDOWN: Device powering off unexpectedly due to overheating. Safety mechanism preventing hardware damage. Requires immediate thermal system service - fan cleaning, thermal paste replacement, and airflow assessment.';
        } else if (text.indexOf('loud') !== -1 || text.indexOf('noisy') !== -1) {
          return 'COOLING SYSTEM STRAIN: Fan running at high speed constantly. May indicate: dust buildup restricting airflow, failing fan bearing, or system under heavy load. Cleaning and diagnostics recommended.';
        }
        return 'THERMAL MANAGEMENT ISSUE: Device exhibiting overheating symptoms. Requires cleaning of cooling system, thermal paste inspection, and airflow verification. Extended overheating can cause permanent component damage.';
      },
      getTroubleshooting: function(text) {
        return '1) Ensure vents are not blocked. 2) Use on hard, flat surface. 3) Clean vents with compressed air. 4) Check running processes for high CPU usage. 5) Monitor temperatures with diagnostic software.';
      }
    },
    {
      keywords: ['physical damage', 'dropped', 'cracked', 'dent', 'water damage', 'spill', 'bent', 'liquid', 'wet'],
      subcategory: 'Physical Damage',
      priority: 'Critical',
      estimatedTime: '3-7 days',
      getDescription: function(text, raw) {
        if (text.indexOf('water') !== -1 || text.indexOf('liquid') !== -1 || text.indexOf('spill') !== -1 || text.indexOf('wet') !== -1) {
          return 'LIQUID DAMAGE INCIDENT: Device exposed to liquid. POWER OFF IMMEDIATELY if not already. Do not attempt to charge. Liquid damage can cause corrosion and short circuits. Requires professional disassembly, cleaning, and assessment. Damage may be extensive and not immediately apparent.';
        } else if (text.indexOf('dropped') !== -1) {
          return 'DROP DAMAGE: Device sustained impact from fall. May have visible damage (dents, cracks) and/or internal component damage not immediately visible. Full diagnostic required to assess functionality of all components.';
        }
        return 'PHYSICAL DAMAGE: Device has sustained physical damage requiring inspection. Assessment needed to determine extent of damage and repair feasibility. May require parts replacement or device replacement.';
      },
      getTroubleshooting: function(text) {
        if (text.indexOf('water') !== -1 || text.indexOf('liquid') !== -1 || text.indexOf('spill') !== -1) {
          return 'IMMEDIATE: 1) Power off device NOW. 2) Do NOT plug in or attempt to charge. 3) Do NOT use rice (myth). 4) Bring to IT immediately for professional service. Time is critical for liquid damage.';
        }
        return '1) Document visible damage with photos. 2) Test all components systematically. 3) Run diagnostics to check for internal damage. 4) Assess repair vs. replacement cost.';
      }
    }
  ];

  // Enhanced software rules
  var softwareRules = [
    {
      keywords: ['blue screen', 'bsod', 'crash', 'system error', 'stop error', 'error code', 'blue screen of death'],
      subcategory: 'Blue Screen/BSOD',
      priority: 'High',
      estimatedTime: '1-3 days',
      getDescription: function(text, raw) {
        return 'SYSTEM CRASH (BSOD): Device experiencing blue screen errors indicating critical system failure. May be caused by: driver conflicts, hardware failure (RAM, storage), corrupted system files, or software incompatibility. Error code analysis required for targeted resolution.';
      },
      getTroubleshooting: function(text) {
        return '1) Note the error code if visible. 2) Boot to Safe Mode. 3) Run Windows Memory Diagnostic. 4) Check Event Viewer for error details. 5) Update/rollback recent driver changes. 6) Run sfc /scannow and DISM commands.';
      }
    },
    {
      keywords: ['slow', 'laggy', 'freezing', 'performance', 'takes forever', 'hanging', 'unresponsive', 'sluggish'],
      subcategory: 'Performance',
      priority: 'Medium',
      estimatedTime: '1-2 days',
      getDescription: function(text, raw) {
        return 'PERFORMANCE DEGRADATION: Device operating below expected speed. User experiencing delays, freezes, or general slowness. Common causes: insufficient RAM, storage nearly full, malware, excessive startup programs, or aging hardware. Comprehensive performance analysis required.';
      },
      getTroubleshooting: function(text) {
        return '1) Check storage space (need 10%+ free). 2) Review Task Manager for resource-heavy processes. 3) Run malware scan. 4) Disable unnecessary startup programs. 5) Check RAM usage. 6) Consider SSD upgrade if using HDD.';
      }
    },
    {
      keywords: ['virus', 'malware', 'infected', 'suspicious', 'popup', 'ransomware', 'adware', 'hacked', 'compromised'],
      subcategory: 'Security/Malware',
      priority: 'Critical',
      estimatedTime: '1-2 days',
      getDescription: function(text, raw) {
        if (text.indexOf('ransomware') !== -1 || text.indexOf('encrypted') !== -1 || text.indexOf('pay') !== -1) {
          return 'CRITICAL SECURITY INCIDENT - RANSOMWARE: Device potentially infected with ransomware. DO NOT pay ransom. Disconnect from network immediately to prevent spread. Device requires isolation, professional malware removal, and data recovery assessment.';
        }
        return 'SECURITY THREAT DETECTED: User reports potential malware infection. Symptoms may include: unwanted popups, browser redirects, slow performance, or suspicious activity. Device requires isolation from network and thorough security scan.';
      },
      getTroubleshooting: function(text) {
        return '1) Disconnect from network. 2) Run full antivirus scan in Safe Mode. 3) Use secondary malware scanner (Malwarebytes). 4) Check browser extensions. 5) Review installed programs for suspicious entries. 6) May require OS reinstall if severe.';
      }
    },
    {
      keywords: ['login', 'password', 'cant log in', "can't log in", 'locked out', 'forgot password', 'sign in', 'credentials', 'account locked'],
      subcategory: 'Account/Authentication',
      priority: 'High',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        if (text.indexOf('locked') !== -1) {
          return 'ACCOUNT LOCKOUT: User account locked due to failed authentication attempts. May be security measure or sync issue. Requires account unlock through appropriate administrative channel and verification of user identity.';
        }
        return 'AUTHENTICATION FAILURE: User unable to access device or account. May be password issue, account expiration, or domain connectivity problem. Identity verification and credential reset may be required.';
      },
      getTroubleshooting: function(text) {
        return '1) Verify correct username/domain. 2) Check Caps Lock and Num Lock. 3) Try password on another device. 4) Check network connectivity for domain accounts. 5) Use self-service password reset if available. 6) Contact IT for administrative reset.';
      }
    },
    {
      keywords: ['windows', 'mac os', 'chrome os', 'operating system', 'os update', 'boot', 'startup', 'boot loop', 'wont boot', 'stuck on logo'],
      subcategory: 'Operating System',
      priority: 'High',
      estimatedTime: '1-3 days',
      getDescription: function(text, raw) {
        if (text.indexOf('loop') !== -1 || text.indexOf('stuck') !== -1 || text.indexOf('keeps restarting') !== -1) {
          return 'BOOT FAILURE: Device stuck in boot loop or unable to complete startup sequence. System may be caught in failed update, corrupted boot configuration, or hardware-related boot failure. Recovery environment access required.';
        }
        return 'OPERATING SYSTEM ISSUE: User reports OS-level problems affecting device startup or operation. May require system repair, recovery, or reinstallation depending on severity.';
      },
      getTroubleshooting: function(text) {
        return '1) Attempt Safe Mode boot. 2) Access recovery environment. 3) Run Startup Repair. 4) Check for failed Windows updates. 5) Boot from recovery media if needed. 6) Last resort: Reset/Reinstall OS.';
      }
    }
  ];

  // Enhanced network rules
  var networkRules = [
    {
      keywords: ['wifi', 'wireless', 'internet', 'no connection', 'cant connect', "can't connect", 'network', 'offline', 'disconnecting', 'no internet'],
      subcategory: 'Network Connectivity',
      priority: 'High',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        if (text.indexOf('disconnect') !== -1 || text.indexOf('drops') !== -1 || text.indexOf('intermittent') !== -1) {
          return 'INTERMITTENT CONNECTIVITY: Network connection dropping repeatedly. May indicate: weak signal, driver issues, power management settings, or infrastructure problems. Location-specific testing needed.';
        }
        return 'NETWORK CONNECTIVITY FAILURE: Device unable to connect to network or internet. Requires verification of WiFi adapter status, driver condition, network credentials, and comparison with other devices in same location.';
      },
      getTroubleshooting: function(text) {
        return '1) Verify WiFi is enabled (check physical switch). 2) Forget and reconnect to network. 3) Run Network Troubleshooter. 4) Update/reinstall network adapter driver. 5) Reset network settings. 6) Test in different location to rule out infrastructure.';
      }
    },
    {
      keywords: ['vpn', 'remote access', 'connect to work', 'remote desktop', 'rdp', 'work from home'],
      subcategory: 'VPN/Remote Access',
      priority: 'High',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        return 'REMOTE ACCESS FAILURE: User unable to establish VPN connection or remote desktop session. May be credential issue, VPN client problem, or network configuration. Critical for remote work capability.';
      },
      getTroubleshooting: function(text) {
        return '1) Verify internet connectivity first. 2) Check VPN credentials. 3) Restart VPN client. 4) Verify VPN client is updated. 5) Check for firewall blocking VPN. 6) Try different network (home vs. mobile hotspot).';
      }
    }
  ];

  // Enhanced peripheral rules
  var peripheralRules = [
    {
      keywords: ['scanner', 'single point', 'barcode', 'scan gun', 'scanning', 'inventory scanner'],
      category: 'Hardware',
      subcategory: 'Peripheral Device',
      priority: 'High',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        return 'SCANNER MALFUNCTION: Barcode/inventory scanner not functioning. Device may have connectivity issue, need reconfiguration, or require replacement. Critical for inventory operations.';
      },
      getTroubleshooting: function(text) {
        return '1) Check USB connection/battery. 2) Verify scanner is paired/configured. 3) Test with different USB port. 4) Scan configuration barcode to reset. 5) Try on different computer. 6) Replace if hardware failure confirmed.';
      }
    },
    {
      keywords: ['printer', 'printing', 'print job', 'paper jam', 'print queue', 'wont print', 'offline printer'],
      category: 'Hardware',
      subcategory: 'Printer',
      priority: 'Medium',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        if (text.indexOf('jam') !== -1) {
          return 'PAPER JAM: Printer has paper obstruction. Requires careful removal of jammed paper and inspection of paper path for debris or damage.';
        } else if (text.indexOf('offline') !== -1) {
          return 'PRINTER OFFLINE: Printer showing offline status. May be network connectivity issue, print spooler problem, or printer configuration change.';
        }
        return 'PRINTER ISSUE: User reports printing problems. May be connectivity, driver, queue, or hardware issue. Systematic troubleshooting required.';
      },
      getTroubleshooting: function(text) {
        return '1) Restart printer. 2) Check printer is online and connected. 3) Clear print queue. 4) Restart Print Spooler service. 5) Remove and re-add printer. 6) Update printer driver.';
      }
    },
    {
      keywords: ['projector', 'no signal', 'projector not working', 'smartboard', 'smart board', 'interactive board', 'classroom display'],
      category: 'Hardware',
      subcategory: 'Display Equipment',
      priority: 'Critical',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        return 'CLASSROOM DISPLAY ISSUE: Projector/smartboard not functioning. May affect instruction. Requires immediate attention to minimize classroom disruption. Check connections, input source selection, and equipment power status.';
      },
      getTroubleshooting: function(text) {
        return '1) Verify projector is powered on. 2) Check all cable connections. 3) Select correct input source on projector. 4) Try different cable. 5) Test with different laptop. 6) Check for overheating (projector may auto-shutdown).';
      }
    },
    {
      keywords: ['headphone', 'headphones', 'headset', 'earbuds', 'earphones', 'audio jack'],
      category: 'Hardware',
      subcategory: 'Headphones/Audio',
      priority: 'Low',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        if (text.indexOf('broken') !== -1 || text.indexOf('damaged') !== -1) {
          return 'HEADPHONE REPLACEMENT: Student/staff headphones physically damaged. Requires replacement from inventory. Document old asset if applicable.';
        }
        return 'AUDIO PERIPHERAL ISSUE: User reports problem with headphones or audio jack. May be device-side audio jack issue or headphone malfunction. Test with different headphones to isolate.';
      },
      getTroubleshooting: function(text) {
        return '1) Test headphones on different device. 2) Test different headphones on same device. 3) Check audio jack for debris. 4) Verify audio output is set to headphones in settings.';
      }
    },
    {
      keywords: ['mouse not working', 'wireless mouse', 'usb mouse', 'mouse battery', 'external mouse'],
      category: 'Hardware',
      subcategory: 'External Mouse',
      priority: 'Low',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        return 'EXTERNAL MOUSE ISSUE: USB or wireless mouse not functioning. May be battery issue (wireless), USB receiver problem, or device driver issue. Provide replacement mouse if troubleshooting fails.';
      },
      getTroubleshooting: function(text) {
        return '1) Replace batteries (wireless mouse). 2) Try different USB port. 3) Check USB receiver is plugged in. 4) Test mouse on different computer. 5) Replace mouse if faulty.';
      }
    },
    {
      keywords: ['charger', 'power adapter', 'ac adapter', 'lost charger', 'need charger', 'charger broken', 'wrong charger'],
      category: 'Hardware',
      subcategory: 'Power Adapter',
      priority: 'Medium',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        if (text.indexOf('lost') !== -1 || text.indexOf('missing') !== -1) {
          return 'CHARGER REPLACEMENT NEEDED: User reports missing/lost power adapter. Issue replacement charger from inventory. Document asset assignment.';
        }
        return 'POWER ADAPTER ISSUE: Charger reported as not working or damaged. Verify with test charger before issuing replacement. Check for damage to charging port as well.';
      },
      getTroubleshooting: function(text) {
        return '1) Verify charger wattage matches device requirements. 2) Test with known-good charger. 3) Check charger LED indicator. 4) Inspect cable for damage. 5) Issue replacement if confirmed faulty.';
      }
    },
    {
      keywords: ['stylus', 'pen', 'touchscreen pen', 'digital pen', 'stylus not working'],
      category: 'Hardware',
      subcategory: 'Stylus/Pen',
      priority: 'Low',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        return 'STYLUS/PEN ISSUE: Digital stylus not responding or functioning incorrectly. May need battery replacement, re-pairing, or replacement if physically damaged.';
      },
      getTroubleshooting: function(text) {
        return '1) Replace stylus battery if applicable. 2) Re-pair stylus via Bluetooth settings. 3) Check stylus tip for damage. 4) Test on different device. 5) Replace if faulty.';
      }
    }
  ];

  // Additional software rules for school environments
  softwareRules.push(
    {
      keywords: ['google classroom', 'classroom', 'google assignment', 'cant submit', 'assignment not showing', 'missing assignment'],
      subcategory: 'Google Classroom',
      priority: 'High',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        return 'GOOGLE CLASSROOM ISSUE: User experiencing problems with Google Classroom functionality. May affect assignment submission or access. Verify account sync, check class enrollment, and clear browser cache.';
      },
      getTroubleshooting: function(text) {
        return '1) Verify signed into correct Google account. 2) Check enrollment in class. 3) Clear browser cache/cookies. 4) Try incognito window. 5) Check Chrome OS version. 6) Contact teacher to verify assignment status.';
      }
    },
    {
      keywords: ['chrome', 'browser', 'extension', 'webpage', 'site not loading', 'blocked site', 'cant access website'],
      subcategory: 'Browser/Chrome',
      priority: 'Medium',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        if (text.indexOf('blocked') !== -1) {
          return 'CONTENT FILTER ISSUE: User unable to access website due to content filter. If site is needed for educational purposes, submit request for filter exception review.';
        }
        return 'BROWSER ISSUE: Chrome or web browsing problem reported. May be extension conflict, cache issue, or site-specific problem. Standard browser troubleshooting required.';
      },
      getTroubleshooting: function(text) {
        return '1) Clear browser cache and cookies. 2) Disable extensions temporarily. 3) Try incognito mode. 4) Check if site works on other devices. 5) Verify network connectivity. 6) Report content filter false positive if applicable.';
      }
    },
    {
      keywords: ['google drive', 'drive', 'files missing', 'sync', 'storage full', 'out of storage', 'drive quota'],
      subcategory: 'Google Drive',
      priority: 'Medium',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        if (text.indexOf('storage') !== -1 || text.indexOf('full') !== -1 || text.indexOf('quota') !== -1) {
          return 'STORAGE QUOTA EXCEEDED: Google Drive storage limit reached. User unable to save new files. Requires cleanup of old files or storage quota increase request.';
        }
        return 'GOOGLE DRIVE ISSUE: User reports problem with Google Drive file access or sync. Verify account, check sync status, and review sharing permissions.';
      },
      getTroubleshooting: function(text) {
        return '1) Check storage quota in Drive settings. 2) Empty Trash to reclaim space. 3) Check if files in Shared with me (not using quota). 4) Verify file sharing permissions. 5) Clear Drive cache if sync issues.';
      }
    },
    {
      keywords: ['testing', 'state test', 'sbac', 'caaspp', 'assessment', 'testing app', 'secure browser'],
      subcategory: 'Assessment/Testing',
      priority: 'Critical',
      estimatedTime: 'Immediate',
      getDescription: function(text, raw) {
        return 'ASSESSMENT PLATFORM ISSUE: Problem affecting state/district testing. CRITICAL PRIORITY during testing windows. Requires immediate attention to prevent testing disruption. Verify secure browser installation and network connectivity.';
      },
      getTroubleshooting: function(text) {
        return '1) Verify secure browser is installed and updated. 2) Check network connectivity. 3) Verify student test session status. 4) Restart device and relaunch secure browser. 5) Contact testing coordinator for session reset if needed.';
      }
    }
  );

  // Additional network rules for school environments
  networkRules.push(
    {
      keywords: ['blocked', 'filter', 'firewall', 'restricted', 'content filter', 'securly', 'goguardian'],
      subcategory: 'Content Filter',
      priority: 'Medium',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        return 'CONTENT FILTER REQUEST: User requesting access to blocked content. Review request for educational validity. Submit filter exception request if appropriate educational use case confirmed.';
      },
      getTroubleshooting: function(text) {
        return '1) Verify the blocked URL. 2) Confirm educational purpose. 3) Check if alternative unblocked resource exists. 4) Submit filter exception request through proper channel. 5) Notify user of expected turnaround time.';
      }
    },
    {
      keywords: ['bluetooth', 'pairing', 'bluetooth device', 'wireless keyboard', 'bluetooth mouse', 'cant pair'],
      subcategory: 'Bluetooth',
      priority: 'Low',
      estimatedTime: 'Same day',
      getDescription: function(text, raw) {
        return 'BLUETOOTH CONNECTIVITY ISSUE: User unable to pair or maintain Bluetooth device connection. May be device compatibility, driver, or distance/interference issue.';
      },
      getTroubleshooting: function(text) {
        return '1) Verify Bluetooth is enabled on device. 2) Put accessory in pairing mode. 3) Remove old pairings and re-pair. 4) Check for driver updates. 5) Reduce distance between devices. 6) Check for interference sources.';
      }
    }
  );

  // Determine channel
  if (text.indexOf('phone') !== -1 || text.indexOf('called') !== -1) {
    result.channel = 'phone';
  } else if (text.indexOf('email') !== -1 || text.indexOf('emailed') !== -1) {
    result.channel = 'email';
  } else if (text.indexOf('walk') !== -1 || text.indexOf('came in') !== -1 || text.indexOf('brought') !== -1 || text.indexOf('in person') !== -1) {
    result.channel = 'walk-in';
  }

  // Determine impact
  if (text.indexOf('entire school') !== -1 || text.indexOf('all teachers') !== -1 || text.indexOf('whole building') !== -1 || text.indexOf('multiple rooms') !== -1 || text.indexOf('classroom') !== -1) {
    result.impact = '3';
    result.impactLabel = 'Single School/Department';
  } else if (text.indexOf('district') !== -1 || text.indexOf('all schools') !== -1) {
    result.impact = '1';
    result.impactLabel = 'District';
  } else if (text.indexOf('several') !== -1 || text.indexOf('multiple') !== -1 || text.indexOf('department') !== -1) {
    result.impact = '3';
    result.impactLabel = 'Single School/Department';
  }

  // Check urgency keywords
  var isUrgent = text.indexOf('urgent') !== -1 || text.indexOf('asap') !== -1 || text.indexOf('emergency') !== -1 ||
                 text.indexOf('critical') !== -1 || text.indexOf('immediately') !== -1 || text.indexOf('cant work') !== -1;

  // Helper function to apply rule match
  function applyRule(rule, categoryName) {
    result.category = rule.category || categoryName;
    result.subcategory = rule.subcategory;
    result.priority = isUrgent ? 'Critical' : (rule.priority || 'Medium');
    result.estimatedTime = rule.estimatedTime || '1-2 days';
    result.improvedDescription = rule.getDescription ? rule.getDescription(text, rawText) : '';
    result.troubleshooting = rule.getTroubleshooting ? rule.getTroubleshooting(text) : '';
    result.confidence = 0.85;
    return true;
  }

  // Check all rule categories
  var allRules = [
    { rules: peripheralRules, category: 'Hardware' },
    { rules: hardwareRules, category: 'Hardware' },
    { rules: softwareRules, category: 'Software' },
    { rules: networkRules, category: 'Network' }
  ];

  for (var c = 0; c < allRules.length; c++) {
    var ruleCategory = allRules[c];
    for (var r = 0; r < ruleCategory.rules.length; r++) {
      var rule = ruleCategory.rules[r];
      for (var k = 0; k < rule.keywords.length; k++) {
        if (text.indexOf(rule.keywords[k]) !== -1) {
          applyRule(rule, ruleCategory.category);
          return result;
        }
      }
    }
  }

  // Default fallback with professional description
  result.category = 'Hardware';
  result.subcategory = 'General';
  result.priority = 'Medium';
  result.estimatedTime = '1-2 days';
  result.improvedDescription = 'TECHNICAL SUPPORT REQUEST: User reports technology issue requiring diagnosis. Initial assessment needed to determine category, scope, and resolution path. Schedule for intake and evaluation.';
  result.troubleshooting = '1) Gather detailed symptom information. 2) Identify affected device(s). 3) Determine when issue started. 4) Check for recent changes. 5) Perform initial diagnostics based on findings.';
  result.confidence = 0.4;

  return result;
}

/**
 * Classify computer repair issue using AI training data and rules
 */
function classifyComputerRepair(rawText) {
  try {
    if (!rawText || rawText.length < 5) {
      return { category: null, subcategory: null, confidence: 0 };
    }

    var text = rawText.toLowerCase();

    // Try to find exact or similar matches in training data first
    var trainingData = getAll('cr_training');
    if (trainingData && trainingData.length > 0) {
      // Tier 1: Exact match
      var exactMatch = trainingData.find(function(t) {
        return t.rawDescription && t.rawDescription.toLowerCase() === text;
      });
      if (exactMatch && exactMatch.category) {
        return {
          category: exactMatch.category,
          subcategory: exactMatch.subcategory || '',
          impact: exactMatch.impact || '4',
          impactLabel: getImpactLabel(exactMatch.impact || '4'),
          improvedDescription: exactMatch.improvedDescription || rawText,
          confidence: 0.95,
          source: 'exact'
        };
      }

      // Tier 2: Similarity match (60%+ word overlap)
      var bestMatch = null;
      var bestScore = 0;
      trainingData.forEach(function(t) {
        if (!t.rawDescription || !t.category) return;
        var score = calculateSimilarity(text, t.rawDescription.toLowerCase());
        if (score > bestScore && score >= 0.6) {
          bestScore = score;
          bestMatch = t;
        }
      });
      if (bestMatch) {
        return {
          category: bestMatch.category,
          subcategory: bestMatch.subcategory || '',
          impact: bestMatch.impact || '4',
          impactLabel: getImpactLabel(bestMatch.impact || '4'),
          improvedDescription: bestMatch.improvedDescription || rawText,
          confidence: bestScore * 0.9,
          source: 'similarity'
        };
      }
    }

    // Tier 3: Rule-based classification for Computer Repair
    var result = classifyCrByRules(text, rawText);
    return result;

  } catch (error) {
    console.log('Error in classifyComputerRepair: ' + error);
    return { category: null, subcategory: null, confidence: 0 };
  }
}

// ============================================
// EMAIL HTML BUILDER
// ============================================

function buildComputerRepairEmailHtml(repair) {
  var incNum = repair.snowIncidentNumber || 'Pending';
  var warrantyBadge = '';
  if (repair.warrantyStatus === 'in-warranty') {
    warrantyBadge = '<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:10px;font-size:12px;">In Warranty</span>';
  } else if (repair.warrantyStatus === 'out-of-warranty') {
    warrantyBadge = '<span style="background:#fef2f2;color:#b91c1c;padding:2px 8px;border-radius:10px;font-size:12px;">Out of Warranty</span>';
  } else {
    warrantyBadge = '<span style="background:#f3f4f6;color:#6b7280;padding:2px 8px;border-radius:10px;font-size:12px;">Unknown</span>';
  }

  return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">' +
    '<div style="background:#0e7490;color:#fff;padding:20px;border-radius:8px 8px 0 0;">' +
      '<h2 style="margin:0;">Computer Repair \u2014 Confirmation</h2>' +
    '</div>' +
    '<div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">' +
      '<p>Hello <strong>' + (repair.employeeName || 'Team Member') + '</strong>,</p>' +
      '<p>Your computer repair request has been logged. A technician will review your device.</p>' +
      '<table style="width:100%;border-collapse:collapse;margin:16px 0;">' +
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;width:140px;">Incident #</td>' +
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">' + incNum + '</td></tr>' +
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Serial Number</td>' +
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;">' + (repair.serialNumber || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Model</td>' +
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;">' + (repair.computerModel || 'N/A') +
            (repair.manufacturer ? ' (' + repair.manufacturer + ')' : '') + '</td></tr>' +
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Warranty</td>' +
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;">' + warrantyBadge + '</td></tr>' +
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Category</td>' +
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;">' + (repair.category || 'N/A') +
            (repair.subcategory ? ' / ' + repair.subcategory : '') + '</td></tr>' +
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Issue</td>' +
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;">' + (repair.shortDescription || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Room</td>' +
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;">' + (repair.roomNumber || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:8px;color:#6b7280;">Details</td>' +
            '<td style="padding:8px;">' + (repair.description || 'N/A') + '</td></tr>' +
      '</table>' +
      '<p style="color:#6b7280;font-size:13px;margin-top:20px;">If you have questions, reply to this email or contact the IT Help Desk.</p>' +
      '<p style="color:#9ca3af;font-size:12px;margin-top:16px;">\u2014 Smart School Monitor</p>' +
    '</div>' +
  '</div>';
}

// ============================================
// ROUTES
// ============================================

/**
 * Create a new computer repair record
 */
router.post('/createComputerRepair', (req, res) => {
  try {
    const [data] = req.body.args || [];
    const now = new Date().toISOString();
    const id = generateId();

    const snowUrl = data.snowIncidentNumber
      ? 'https://pbcsd.service-now.com/nav_to.do?uri=incident.do?sysparm_query=number=' + data.snowIncidentNumber
      : '';

    // Determine warranty status
    var warrantyStatus = 'unknown';
    if (data.warrantyDate) {
      var wDate = new Date(data.warrantyDate);
      if (!isNaN(wDate.getTime())) {
        warrantyStatus = wDate > new Date() ? 'in-warranty' : 'out-of-warranty';
      }
    }

    // Limit photo data URL to avoid exceeding size limits
    var photoData = data.photoDataUrl || '';
    if (photoData.length > 45000) {
      console.log('Photo data too large (' + photoData.length + ' chars), truncating');
      photoData = '';
    }

    const repairData = {
      id: id,
      employeeId: data.employeeId || '',
      employeeName: data.employeeName || '',
      employeeEmail: data.employeeEmail || '',
      roomNumber: data.roomNumber || '',
      serialNumber: data.serialNumber || '',
      computerModel: data.computerModel || '',
      manufacturer: data.manufacturer || '',
      warrantyDate: data.warrantyDate || '',
      warrantyStatus: warrantyStatus,
      assetTag: data.assetTag || '',
      shortDescription: data.shortDescription || '',
      description: data.description || '',
      category: data.category || '',
      subcategory: data.subcategory || '',
      channel: data.channel || '',
      impact: data.impact || '',
      userType: data.userType || '',
      snowIncidentNumber: data.snowIncidentNumber || '',
      snowUrl: snowUrl,
      repairStatus: data.repairStatus || 'pending',
      emailStatus: data.emailStatus || 'not-sent',
      emailSentAt: '',
      photoDataUrl: photoData,
      createdAt: now,
      updatedAt: now,
      isQuickTicket: data.isQuickTicket ? 'TRUE' : 'FALSE'
    };

    insert('computer_repairs', repairData);

    // Return without photoDataUrl for bandwidth efficiency
    var responseRepair = Object.assign({}, repairData);
    delete responseRepair.photoDataUrl;

    console.log('Computer repair created: ' + id);
    res.json({ success: true, repair: responseRepair });
  } catch (error) {
    console.log('Error creating computer repair: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Get recent computer repairs (omit photoDataUrl for listing)
 */
router.post('/getComputerRepairs', (req, res) => {
  try {
    const [limit] = req.body.args || [200];
    var repairs = getAll('computer_repairs');
    // Don't return photoDataUrl in listing to save bandwidth
    repairs = repairs.map(function(r) {
      var copy = {};
      for (var k in r) {
        if (k !== 'photoDataUrl') copy[k] = r[k];
      }
      return copy;
    });
    repairs.sort(function(a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    if (limit && limit > 0) {
      repairs = repairs.slice(0, limit);
    }
    res.json({ success: true, repairs: repairs });
  } catch (error) {
    console.log('Error getting computer repairs: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Get a single computer repair by ID (includes photoDataUrl)
 */
router.post('/getComputerRepairById', (req, res) => {
  try {
    const [repairId] = req.body.args || [];
    const repair = getById('computer_repairs', repairId);
    if (!repair) {
      return res.json({ success: false, error: 'Repair not found' });
    }
    res.json({ success: true, repair: repair });
  } catch (error) {
    console.log('Error getting repair by ID: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Update a single field on a computer repair record
 */
router.post('/updateComputerRepairField', (req, res) => {
  try {
    const [repairId, fieldName, value] = req.body.args || [];
    updateField('computer_repairs', repairId, fieldName, value);
    updateField('computer_repairs', repairId, 'updatedAt', new Date().toISOString());
    res.json({ success: true });
  } catch (error) {
    console.log('Error updating computer repair field: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Send computer repair confirmation email immediately
 */
router.post('/sendComputerRepairEmail', async (req, res) => {
  try {
    const [repairId] = req.body.args || [];
    const repair = getById('computer_repairs', repairId);
    if (!repair) {
      return res.json({ success: false, error: 'Repair record not found' });
    }
    if (!repair.employeeEmail) {
      return res.json({ success: false, error: 'No employee email on record' });
    }

    var subject = 'Computer Repair Logged: ' + (repair.shortDescription || 'Your Computer Issue');
    var htmlBody = buildComputerRepairEmailHtml(repair);

    const result = await sendEmail({
      to: repair.employeeEmail,
      subject: subject,
      html: htmlBody
    });

    if (result.success) {
      updateField('computer_repairs', repairId, 'emailStatus', 'sent');
      updateField('computer_repairs', repairId, 'emailSentAt', new Date().toISOString());
      updateField('computer_repairs', repairId, 'updatedAt', new Date().toISOString());
      console.log('Computer repair email sent to: ' + repair.employeeEmail);
      res.json({ success: true, message: 'Email sent to ' + repair.employeeEmail });
    } else {
      updateField('computer_repairs', repairId, 'emailStatus', 'failed');
      updateField('computer_repairs', repairId, 'updatedAt', new Date().toISOString());
      res.json({ success: false, error: result.error || 'Failed to send email' });
    }
  } catch (error) {
    console.log('Error sending computer repair email: ' + error);
    const repairId = (req.body.args || [])[0];
    try { if (repairId) updateField('computer_repairs', repairId, 'emailStatus', 'failed'); } catch(e) {}
    res.json({ success: false, error: error.message });
  }
});

/**
 * Queue a computer repair email for later sending
 */
router.post('/queueComputerRepairEmail', (req, res) => {
  try {
    const [repairId] = req.body.args || [];
    const repair = getById('computer_repairs', repairId);
    if (!repair) {
      return res.json({ success: false, error: 'Repair record not found' });
    }
    if (!repair.employeeEmail) {
      return res.json({ success: false, error: 'No employee email on record' });
    }

    var subject = 'Computer Repair Logged: ' + (repair.shortDescription || 'Your Computer Issue');
    var htmlBody = buildComputerRepairEmailHtml(repair);

    var now = new Date().toISOString();
    var queueId = generateId();

    insert('email_queue', {
      id: queueId,
      incidentId: repairId,
      toAddr: repair.employeeEmail,
      subject: subject,
      body: htmlBody,
      status: 'pending',
      scheduledAt: now,
      sentAt: '',
      createdAt: now,
      error: ''
    });

    updateField('computer_repairs', repairId, 'emailStatus', 'queued');
    updateField('computer_repairs', repairId, 'updatedAt', new Date().toISOString());

    res.json({ success: true, message: 'Email queued for ' + repair.employeeEmail });
  } catch (error) {
    console.log('Error queuing computer repair email: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Classify a computer repair issue using the 3-tier AI engine
 */
router.post('/classifyComputerRepair', (req, res) => {
  try {
    const [rawText] = req.body.args || [];
    const result = classifyComputerRepair(rawText || '');
    res.json(result);
  } catch (error) {
    console.log('classifyComputerRepair route error: ' + error);
    res.json({ category: null, subcategory: null, confidence: 0 });
  }
});

/**
 * Save computer repair AI training entry
 */
router.post('/saveCrTrainingEntry', (req, res) => {
  try {
    const [data] = req.body.args || [];
    var id = generateId();
    var now = new Date().toISOString();

    insert('cr_training', {
      id: id,
      rawDescription: data.rawDescription || '',
      improvedDescription: data.improvedDescription || '',
      category: data.category || '',
      subcategory: data.subcategory || '',
      impact: data.impact || '4',
      aiAccepted: data.aiAccepted ? 'TRUE' : 'FALSE',
      confidence: data.confidence || 0,
      source: data.source || 'manual',
      repairId: data.repairId || '',
      isQuickTicket: data.isQuickTicket ? 'TRUE' : 'FALSE',
      createdAt: now
    });

    res.json({ success: true, id: id });
  } catch (error) {
    console.log('Error saving CR training entry: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Find similar past computer repairs (30%+ Jaccard similarity)
 */
router.post('/findSimilarComputerRepairs', (req, res) => {
  try {
    const [searchText] = req.body.args || [];
    if (!searchText || searchText.length < 5) {
      return res.json({ success: true, issues: [] });
    }

    var repairs = getAll('computer_repairs');
    if (!repairs || repairs.length === 0) {
      return res.json({ success: true, issues: [] });
    }

    var text = searchText.toLowerCase();
    var matches = [];

    repairs.forEach(function(r) {
      if (!r.shortDescription && !r.description) return;

      var desc = ((r.shortDescription || '') + ' ' + (r.description || '')).toLowerCase();
      var score = calculateSimilarity(text, desc);

      if (score >= 0.3) {
        matches.push({
          id: r.id,
          shortDescription: r.shortDescription,
          description: r.description,
          category: r.category,
          subcategory: r.subcategory,
          score: score
        });
      }
    });

    // Sort by score descending
    matches.sort(function(a, b) { return b.score - a.score; });

    res.json({ success: true, issues: matches.slice(0, 5) });
  } catch (error) {
    console.log('Error finding similar repairs: ' + error);
    res.json({ success: false, error: error.message, issues: [] });
  }
});

/**
 * Get all repair ticket templates
 */
router.post('/getRepairTemplates', (req, res) => {
  try {
    var data = getAll('repair_templates');
    res.json((data || []).filter(function(t) { return t && t.id; }));
  } catch (error) {
    console.log('Error getting repair templates: ' + error);
    res.json([]);
  }
});

/**
 * Save (create or update) a repair ticket template
 */
router.post('/saveRepairTemplate', (req, res) => {
  try {
    const [template] = req.body.args || [];
    var now = new Date().toISOString();
    var id = template.id || generateId();

    var templateData = {
      id: id,
      name: template.name || '',
      icon: template.icon || 'file-text',
      shortDescription: template.shortDescription || '',
      description: template.description || '',
      channel: template.channel || 'self-service',
      category: template.category || 'Hardware',
      subcategory: template.subcategory || '',
      serviceOffering: template.serviceOffering || 'Other',
      manufacturer: template.manufacturer || '',
      model: template.model || '',
      assetLocation: template.assetLocation || '',
      impact: template.impact || '4',
      userType: template.userType || 'school_staff',
      requiresSerial: template.requiresSerial !== false ? 'TRUE' : 'FALSE',
      requiresPhoto: template.requiresPhoto !== false ? 'TRUE' : 'FALSE',
      sortOrder: template.sortOrder || 0,
      active: template.active !== false ? 'TRUE' : 'FALSE',
      createdAt: template.createdAt || now,
      updatedAt: now
    };

    var existing = getById('repair_templates', id);
    if (existing) {
      templateData.createdAt = existing.createdAt || now;
      update('repair_templates', id, templateData);
    } else {
      insert('repair_templates', templateData);
    }

    res.json({ success: true, id: id });
  } catch (error) {
    console.log('Error saving repair template: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Delete a repair ticket template
 */
router.post('/deleteRepairTemplate', (req, res) => {
  try {
    const [templateId] = req.body.args || [];
    var existing = getById('repair_templates', templateId);
    if (existing) {
      remove('repair_templates', templateId);
      res.json({ success: true });
    } else {
      res.json({ success: false, error: 'Template not found' });
    }
  } catch (error) {
    console.log('Error deleting repair template: ' + error);
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;
