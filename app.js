const tenders=[
{sector:"Construction",title:"Construction of District Roads",source:"Local Government • Uganda",deadline:"28 Sep 2026",match:94},
{sector:"Construction",title:"Renovation of Public Facilities",source:"Government Procurement",deadline:"04 Oct 2026",match:89},
{sector:"Supplies",title:"Supply of Office Equipment",source:"Public Institution",deadline:"11 Oct 2026",match:82},
{sector:"IT",title:"ICT Infrastructure & Support Services",source:"Government Agency",deadline:"16 Oct 2026",match:91},
{sector:"Consultancy",title:"Consultancy Services for Project Management",source:"Public Authority",deadline:"22 Oct 2026",match:76},
{sector:"Supplies",title:"Supply of Construction Materials",source:"Local Government",deadline:"30 Oct 2026",match:87}];
function render(a=tenders){grid.innerHTML=a.length?a.map(t=>`<article class="tender"><label>${t.sector.toUpperCase()}</label><h3>${t.title}</h3><p>${t.source}</p><div class="meta"><span>Deadline: ${t.deadline}</span><span class="green">${t.match}% match</span></div></article>`).join(""):`<article class="tender"><h3>No matching tenders</h3><p>Try another search.</p></article>`}
function filter(){let s=sector.value,q=document.getElementById("q").value.toLowerCase();render(tenders.filter(t=>(s==="All sectors"||t.sector===s)&&(t.title+" "+t.source+" "+t.sector).toLowerCase().includes(q)))}
function signup(plan){mt.textContent="Start "+plan;modal.classList.remove("hidden")}
function closeModal(){modal.classList.add("hidden")}
function submitForm(){if(!name.value.trim()||!email.value.trim()){alert("Enter your business name and email.");return}msg.textContent="Request captured in this MVP. Backend connection comes next."}
render();