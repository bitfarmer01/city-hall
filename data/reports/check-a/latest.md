# Check A — catalog coverage sample report

Run 2026-10-30T18:42:03.851Z · fixed seed `20261030` · sample 100 of 2,093 articles (snapshot `data/snapshots/nyc311-index/2026-10-30.json`, sha `63aff11a928c`, captured 2026-10-30T17:11:43.820Z).

Versions: catalog `2026-10-30.1` · crosswalk rules `1.0.0` · classifier `1.0.0` · domain taxonomy `1.0.0` · retriever `lexical-hash-v1`.

**Gate PASS** — 100/100 (100%) resolved to a service record or an explicit out-of-scope entry (threshold 95%); 79 service records, 21 out-of-scope, 0 failures, 0 validity breach(es), 0 dead page(s).

## Per coverage domain

| Domain | Sampled | Service records | Matched own catalog service | Matched sibling service | No catalog match (gap) | Out-of-scope | Failures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Permits | 4 | 4 | 0 | 4 | 0 | 0 | 0 |
| 311 service requests | 29 | 27 | 0 | 2 | 25 | 2 | 0 |
| Public records | 1 | 1 | 1 | 0 | 0 | 0 | 0 |
| Licensing | 9 | 8 | 0 | 6 | 2 | 1 | 0 |
| Inspections | 1 | 1 | 0 | 0 | 1 | 0 | 0 |
| Other (untagged) | 56 | 38 | 0 | 1 | 37 | 18 | 0 |

_No catalog match_ counts service-classified articles whose crosswalk resolution returned no catalog service — the visible catalog-coverage gap; it narrows as the catalog grows.

## Per-article results

| KA | Title | Domain | Disposition | Outcome | Matched service IDs | Layer |
| --- | --- | --- | --- | --- | --- | --- |
| KA-01012 | Birth Certificate Order | public-records | service | service_record | svc:dohmh:birth-certificate-order | alias-rules |
| KA-01030 | Marriage Record | other | service | service_record | — | search-fallback |
| KA-01035 | Fire Hydrant Request | other | service | service_record | — | search-fallback |
| KA-01087 | Noise from Dog or Other Animal | service-requests | service | service_record | svc:311:noise-from-neighbor | semantic-retrieval |
| KA-01091 | Noise from Construction | service-requests | service | service_record | svc:311:noise-from-neighbor, svc:buildings:building-construction-alteration-permit | semantic-retrieval |
| KA-01134 | Nursing Jobs | other | informational | out_of_scope | — | — |
| KA-01146 | Cigarette Wholesaler License | licensing | service | service_record | svc:dohmh:dog-license, svc:dcwp:home-improvement-contractor-license | semantic-retrieval |
| KA-01158 | City Vehicle Complaint | service-requests | service | service_record | — | search-fallback |
| KA-01325 | Mental Health Patient Not Following Treatment Plan | other | service | service_record | — | search-fallback |
| KA-01347 | Public Recycling | other | informational | out_of_scope | — | — |
| KA-01396 | Working Horse Rules | other | informational | out_of_scope | — | — |
| KA-01430 | Drying Oven Permit | permits | service | service_record | svc:dohmh:food-service-establishment-permit, svc:buildings:building-construction-alteration-permit | semantic-retrieval |
| KA-01434 | Elderly Pharmaceutical Insurance Coverage (EPIC) Program | other | informational | out_of_scope | — | — |
| KA-01440 | Emerging Business Enterprise Program | other | service | service_record | — | search-fallback |
| KA-01454 | FDNY Ambulance Billing | service-requests | service | service_record | — | search-fallback |
| KA-01499 | Service Dogs | other | service | service_record | svc:dohmh:dog-license | semantic-retrieval |
| KA-01501 | Traveling Abroad | other | informational | out_of_scope | — | — |
| KA-01517 | Building Demolition Rat Extermination Certificate | other | service | service_record | — | search-fallback |
| KA-01546 | Foster Child Assistance | other | service | service_record | — | search-fallback |
| KA-01570 | Independent Living Centers | other | informational | out_of_scope | — | — |
| KA-01592 | New York City Tourism + Conventions Business Membership | other | informational | out_of_scope | — | — |
| KA-01597 | Pesticide Application Without Notice | service-requests | service | service_record | — | search-fallback |
| KA-01614 | Radioactive Materials License | licensing | service | service_record | svc:dcwp:home-improvement-contractor-license, svc:dohmh:dog-license | semantic-retrieval |
| KA-01615 | Reckless Driving | service-requests | out-of-scope | out_of_scope | — | — |
| KA-01620 | Play Sure Kit | other | service | service_record | — | search-fallback |
| KA-01652 | Volunteer Screening for Non-Profits | other | service | service_record | — | search-fallback |
| KA-01680 | Property Tax Bill Assistance | other | service | service_record | — | search-fallback |
| KA-01685 | Volunteer with Older Adults | other | service | service_record | — | search-fallback |
| KA-01726 | Made In New York Production Assistant Program | other | service | service_record | — | search-fallback |
| KA-01727 | Material and Equipment Acceptance Application | other | service | service_record | — | search-fallback |
| KA-01735 | Nursing Home Complaint | service-requests | service | service_record | — | search-fallback |
| KA-01754 | Site Safety Manager Complaint | service-requests | service | service_record | — | search-fallback |
| KA-01755 | Small Business Compliance Consultation | other | service | service_record | — | search-fallback |
| KA-01810 | Secondhand Dealer Auto License | licensing | service | service_record | svc:dohmh:dog-license, svc:dcwp:home-improvement-contractor-license | semantic-retrieval |
| KA-01814 | Horse Drawn Cab License | licensing | service | service_record | svc:dohmh:dog-license | semantic-retrieval |
| KA-01815 | Catering Establishment License | licensing | out-of-scope | out_of_scope | — | — |
| KA-01825 | Temporary Food Service Establishment Permit | permits | service | service_record | svc:dohmh:food-service-establishment-permit | alias-rules |
| KA-01839 | Horse Drawn Cab Driver License | licensing | service | service_record | — | search-fallback |
| KA-01869 | Ticket Seller Business License | licensing | service | service_record | svc:dohmh:dog-license | semantic-retrieval |
| KA-01871 | Sightseeing Bus License | licensing | service | service_record | svc:dohmh:dog-license, svc:dcwp:home-improvement-contractor-license | semantic-retrieval |
| KA-01908 | Air Conditioner in Danger of Falling | service-requests | service | service_record | — | search-fallback |
| KA-01913 | Gas Piping or Hookup Complaint | service-requests | service | service_record | — | search-fallback |
| KA-01944 | Tattoo Parlor Complaint | service-requests | service | service_record | — | search-fallback |
| KA-02002 | Incarcerated Person Visit | other | service | service_record | — | search-fallback |
| KA-02043 | Landmark Building Alteration Permit | permits | service | service_record | svc:buildings:building-construction-alteration-permit | alias-rules |
| KA-02053 | Crane or Derrick Complaint | service-requests | service | service_record | — | search-fallback |
| KA-02064 | Nurses for Pregnant People and Teens | other | service | service_record | — | search-fallback |
| KA-02077 | Watershed Recreation and Access Permit | permits | service | service_record | svc:dohmh:food-service-establishment-permit, svc:buildings:building-construction-alteration-permit | semantic-retrieval |
| KA-02084 | Family Justice Centers | other | informational | out_of_scope | — | — |
| KA-02088 | Marriage Registration | other | service | service_record | — | search-fallback |
| KA-02171 | Hotel Complaint | service-requests | service | service_record | — | search-fallback |
| KA-02195 | Games of Chance Complaint | service-requests | service | service_record | — | search-fallback |
| KA-02217 | NYC Parks Stewardship Program | other | service | service_record | — | search-fallback |
| KA-02225 | Animal Facility Complaint | service-requests | service | service_record | — | search-fallback |
| KA-02232 | Biking, Rollerblading, or Skating Complaint | service-requests | service | service_record | — | search-fallback |
| KA-02245 | Dead Animal on Public Property | service-requests | service | service_record | — | search-fallback |
| KA-02246 | Agency Charges Collected by the Department of Finance | other | service | service_record | — | search-fallback |
| KA-02270 | Oil Spill | service-requests | service | service_record | — | search-fallback |
| KA-02276 | Pedestrian Ramp Complaint | service-requests | service | service_record | — | search-fallback |
| KA-02298 | Standing Water | service-requests | service | service_record | — | search-fallback |
| KA-02325 | Bus Lane and MTA Bus Cameras | other | service | service_record | — | search-fallback |
| KA-02343 | Red Light Camera Complaint | service-requests | service | service_record | — | search-fallback |
| KA-02355 | Sheltered Bike Parking | other | informational | out_of_scope | — | — |
| KA-02520 | CityPay | other | service | service_record | — | search-fallback |
| KA-02531 | Police Stops | service-requests | service | service_record | — | search-fallback |
| KA-02560 | Anti-Smoking Advertising Complaint | service-requests | service | service_record | — | search-fallback |
| KA-02567 | Beacon Community Centers | other | informational | out_of_scope | — | — |
| KA-02573 | Benchmarking and Energy Grading Requirements | other | service | service_record | — | search-fallback |
| KA-02575 | Bike Map | other | service | service_record | — | search-fallback |
| KA-02639 | City Flag Status | other | informational | out_of_scope | — | — |
| KA-02640 | City Health Information (CHI) for Health Care Providers | other | service | service_record | — | search-fallback |
| KA-02658 | Construction Site Safety | other | service | service_record | — | search-fallback |
| KA-02683 | Department of Consumer and Worker Protection Violation Business Assistance | other | service | service_record | — | search-fallback |
| KA-02726 | Fingerprinting | licensing | service | service_record | — | search-fallback |
| KA-02728 | Fire or Ambulance Report | service-requests | service | service_record | — | search-fallback |
| KA-02731 | Fire Safety Director On-Site Test | other | service | service_record | — | search-fallback |
| KA-02785 | Home Instruction and Schooling | other | service | service_record | — | search-fallback |
| KA-02820 | Incarcerated Person Jail Release Services | other | service | service_record | — | search-fallback |
| KA-02824 | International Affairs Community Assistance | other | service | service_record | — | search-fallback |
| KA-02843 | Lead Safety for Landlords and Construction Professionals | other | informational | out_of_scope | — | — |
| KA-02859 | Mechanical Sprinkler or Standpipe Inspection | inspections | service | service_record | — | search-fallback |
| KA-02898 | NYC Business Solutions Center | other | service | service_record | — | search-fallback |
| KA-02908 | Paid Care Worker or Employer Assistance | other | service | service_record | — | search-fallback |
| KA-02921 | Pet Health and Welfare Resources | other | service | service_record | — | search-fallback |
| KA-02947 | Pet Vaccination | other | service | service_record | — | search-fallback |
| KA-02953 | Refund Policy Rules | other | informational | out_of_scope | — | — |
| KA-03005 | Sign Hanger Complaint | service-requests | service | service_record | — | search-fallback |
| KA-03029 | Student Educational Support | other | service | service_record | — | search-fallback |
| KA-03076 | Telephone Pole or Wire Complaint | service-requests | service | service_record | — | search-fallback |
| KA-03139 | Property or Vacant Land Description Update | other | service | service_record | — | search-fallback |
| KA-03167 | Health Insurance Application Assistance | other | service | service_record | — | search-fallback |
| KA-03218 | Immigration and Customs Enforcement (ICE) Raids | other | informational | out_of_scope | — | — |
| KA-03264 | Coat Drive | other | informational | out_of_scope | — | — |
| KA-03317 | NYC Care | other | informational | out_of_scope | — | — |
| KA-03379 | Marijuana Use by a Minor | service-requests | out-of-scope | out_of_scope | — | — |
| KA-03480 | Scattering Ashes and Cremated Remains in Parks | other | informational | out_of_scope | — | — |
| KA-03574 | Bed Bug Annual Report | service-requests | service | service_record | — | search-fallback |
| KA-03623 | Pedestrian Plazas | service-requests | service | service_record | — | search-fallback |
| KA-03747 | New York State POWER Check | other | informational | out_of_scope | — | — |
| KA-03749 | Metropolitan Opera Ticket Lottery | other | service | service_record | — | search-fallback |

