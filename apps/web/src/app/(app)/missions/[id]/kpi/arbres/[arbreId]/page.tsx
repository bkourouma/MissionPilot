import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoutonActionKpi } from "../../../../../../../components/kpi/BoutonActionKpi";
import { ContributionsArbreKpi } from "../../../../../../../components/kpi/ContributionsArbre";
import {
  ChangerRelationNoeud,
  FormulaireNoeud,
} from "../../../../../../../components/kpi/FormulairesArbreKpi";
import "../../../../../../../components/kpi/kpi.css";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../../components/ui/Carte";
import { Champ } from "../../../../../../../components/ui/Champ";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../../../lib/identifiant";
import { ajouterJoursIso, droitsKpi } from "../../../../../../../lib/kpi";
import {
  cheminArbre,
  cheminContributions,
  cheminNoeud,
  hrefArbre,
  hrefArbres,
  libelleRelation,
  ordonnerNoeudsArbre,
  type ContributionsArbre,
  type DetailArbre,
  type NoeudArbre,
} from "../../../../../../../lib/kpi-pilotage";
import { chargerOptionsPilotage } from "../../../../../../../lib/kpi-pilotage-serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { aujourdhui, dateValide } from "../../../../../../../lib/periode";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Arbre d'indicateurs", "KPI tree") };
}

const texte = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Un arbre d'indicateurs : ses nœuds, la décomposition chiffrée de la variation du KPI racine
 * entre deux dates d'arrêté (par défaut : il y a 90 jours et aujourd'hui) et, pour le responsable
 * de la mission, l'ajout et la désactivation de leviers.
 */
export default async function PageArbreKpi({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; arbreId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, arbreId } = await params;
  if (!estIdentifiant(arbreId)) notFound();
  const { utilisateur } = await exigerPermission("kpi.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const jour = aujourdhui();
  const q = await searchParams;
  const apresBrut = texte(q.apres);
  const avantBrut = texte(q.avant);
  const apres = apresBrut && dateValide(apresBrut) ? apresBrut : jour;
  const avant = avantBrut && dateValide(avantBrut) ? avantBrut : ajouterJoursIso(apres, -90);
  const [arbre, contributions, options] = await Promise.all([
    chargerServeur<DetailArbre>(cheminArbre(arbreId)),
    avant < apres
      ? chargerServeur<ContributionsArbre>(cheminContributions(arbreId, avant, apres))
      : Promise.resolve(null),
    chargerOptionsPilotage(utilisateur.roles, m, m.id, langue),
  ]);
  if (!arbre.ok && arbre.statut === 404) notFound();
  if (!arbre.ok) {
    return (
      <EtatErreur
        titre={t("L'arbre n'a pas pu être chargé.", "The tree could not be loaded.")}
        message={arbre.message}
        hrefReessayer={hrefArbre(m.id, arbreId)}
      />
    );
  }
  // Un arbre d'une autre mission que celle de l'URL n'existe pas pour cette page.
  if (arbre.donnees.mission_id !== m.id) notFound();
  const a = arbre.donnees;
  const parId = new Map(a.noeuds.map((n) => [n.id, n]));
  return (
    <div className="mp-kpi">
      <div className="mp-actions-formulaire">
        <Link href={hrefArbres(m.id)} className={classesBouton("secondaire")}>
          {t("Revenir aux arbres", "Back to the trees")}
        </Link>
      </div>
      <h2 className="mp-kpi-section__titre">{a.libelle}</h2>
      {a.description ? <p className="mp-texte-doux">{a.description}</p> : null}

      <form method="get" action={hrefArbre(m.id, arbreId)} className="mp-kpi-barre" role="search">
        <div className="mp-kpi-barre__date">
          <Champ
            libelle={t("Situation « avant » (arrêté)", 'Situation "before" (cut-off)')}
            type="date"
            name="avant"
            defaultValue={avant}
            max={jour}
          />
          <Champ
            libelle={t("Situation « après » (arrêté)", 'Situation "after" (cut-off)')}
            type="date"
            name="apres"
            defaultValue={apres}
          />
          <button type="submit" className={classesBouton("secondaire")}>
            {t("Décomposer", "Break down")}
          </button>
        </div>
      </form>

      <Carte
        titre={t(
          `Contributions entre le ${formaterDate(avant, "UTC", langue)} et le ${formaterDate(apres, "UTC", langue)}`,
          `Contributions between ${formaterDate(avant, "UTC", langue)} and ${formaterDate(apres, "UTC", langue)}`,
        )}
      >
        {contributions === null ? (
          <Alerte
            tonalite="attention"
            titre={t("Dates incohérentes", "Inconsistent dates")}
            annonce="status"
          >
            <p>
              {t(
                "La date « avant » doit précéder la date « après ».",
                'The "before" date must precede the "after" date.',
              )}
            </p>
          </Alerte>
        ) : !contributions.ok ? (
          <EtatErreur
            titre={t(
              "La décomposition n'a pas pu être calculée.",
              "The breakdown could not be computed.",
            )}
            message={contributions.message}
            hrefReessayer={hrefArbre(m.id, arbreId, `avant=${avant}&apres=${apres}`)}
          />
        ) : (
          <ContributionsArbreKpi contributions={contributions.donnees} />
        )}
      </Carte>

      <Carte titre={t("Nœuds de l'arbre", "Tree nodes")}>
        <Tableau<NoeudArbre>
          legende={t("Nœuds de l'arbre d'indicateurs", "Nodes of the KPI tree")}
          colonnes={[
            { cle: "libelle", entete: t("Nœud", "Node") },
            {
              cle: "parent",
              entete: t("Sous", "Under"),
              rendu: (n) =>
                n.parent_id ? (parId.get(n.parent_id)?.libelle ?? "—") : t("Racine", "Root"),
            },
            {
              cle: "kpi",
              entete: t("KPI lié", "Linked KPI"),
              rendu: (n) =>
                n.kpi_libelle
                  ? `${n.kpi_libelle}${n.kpi_unite ? ` (${n.kpi_unite})` : ""}`
                  : t("Levier libre", "Free driver"),
            },
            {
              cle: "relation",
              entete: t("Combine ses leviers en", "Combines its drivers as"),
              rendu: (n) => libelleRelation(n.relation, langue),
            },
            {
              cle: "coefficient",
              entete: t("Coefficient", "Coefficient"),
              alignement: "droite",
            },
            { cle: "rang", entete: t("Rang", "Rank"), alignement: "droite" },
            {
              cle: "actif",
              entete: t("Situation", "Status"),
              rendu: (n) => (n.actif ? t("Actif", "Active") : t("Désactivé", "Disabled")),
            },
            ...(droits.gerer
              ? [
                  {
                    cle: "action",
                    entete: t("Action", "Action"),
                    rendu: (n: NoeudArbre) => (
                      <div className="mp-pile">
                        {n.actif ? <ChangerRelationNoeud noeud={n} /> : null}
                        {n.parent_id === null ? null : (
                          <BoutonActionKpi
                            libelle={
                              n.actif ? t("Désactiver", "Disable") : t("Réactiver", "Reactivate")
                            }
                            chemin={cheminNoeud(n.id)}
                            methode="PATCH"
                            corps={{ actif: !n.actif }}
                            succes={
                              n.actif
                                ? t("Levier désactivé.", "Driver disabled.")
                                : t("Levier réactivé.", "Driver reactivated.")
                            }
                            variante="discret"
                          />
                        )}
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
          lignes={ordonnerNoeudsArbre(a.noeuds)}
          cleLigne={(n) => n.id}
        />
      </Carte>

      {droits.gerer ? (
        <Carte titre={t("Ajouter un levier", "Add a driver")}>
          <FormulaireNoeud arbreId={arbreId} noeuds={a.noeuds} kpis={options.kpis} />
        </Carte>
      ) : null}
    </div>
  );
}
