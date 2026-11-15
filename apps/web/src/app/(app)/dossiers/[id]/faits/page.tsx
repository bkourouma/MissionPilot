import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { ActionsFait } from "../../../../../components/dossier/ActionsFait";
import { EnteteDossier } from "../../../../../components/dossier/EnteteDossier";
import { FormulaireFait } from "../../../../../components/dossier/FormulaireFait";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  formaterSource,
  formaterValeurFait,
  grouperParCategorie,
  statutFait,
  type Fait,
  type VueDossier,
} from "../../../../../lib/dossier";
import { formaterDate, formaterDateHeure } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Faits du dossier", "File facts") };
}

/** Tous les faits du dossier, historique compris ; ajout, confirmation, remplacement. */
export default async function PageFaits({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("dossier.lire");
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const peutEcrire = aPermission(utilisateur.roles, "dossier.ecrire");
  const brut = (await searchParams).fait;
  const faitHistorique = typeof brut === "string" && estIdentifiant(brut) ? brut : null;
  const [dossier, faits, historique] = await Promise.all([
    chargerServeur<VueDossier>(`/api/dossiers/${id}`),
    chargerServeur<{ elements: Fait[] }>(`/api/dossiers/${id}/faits?vue=tous`),
    faitHistorique
      ? chargerServeur<{ elements: Fait[] }>(
          `/api/dossiers/${id}/faits/${faitHistorique}/historique`,
        )
      : Promise.resolve(null),
  ]);
  if (!dossier.ok && dossier.statut === 404) notFound();
  if (!dossier.ok || !faits.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Faits du dossier", "File facts")}
          retour={{ href: `/dossiers/${id}`, libelle: t("Dossier", "File") }}
        />
        <EtatErreur
          titre={t(
            "Les faits du dossier n'ont pas pu être chargés.",
            "The file facts could not be loaded.",
          )}
          message={!dossier.ok ? dossier.message : !faits.ok ? faits.message : ""}
          hrefReessayer={`/dossiers/${id}/faits`}
        />
      </div>
    );
  }

  return (
    <div className="mp-page">
      <EnteteDossier client={dossier.donnees.client} fiabilite={dossier.donnees.fiabilite} />

      {peutEcrire ? (
        <Carte titre={t("Ajouter un fait", "Add a fact")}>
          <FormulaireFait clientId={id} />
        </Carte>
      ) : null}

      {historique ? (
        <Carte titre={t("Historique d'un fait", "History of a fact")}>
          {historique.ok ? (
            <ol className="mp-pile">
              {historique.donnees.elements.map((f) => (
                <li key={f.id}>
                  <strong>{formaterValeurFait(f.valeur, langue)}</strong> {t("au", "on")}{" "}
                  {formaterDate(f.date_effet, "UTC", langue)}{" "}
                  <BadgeStatut tonalite={statutFait(f.statut, langue).tonalite}>
                    {statutFait(f.statut, langue).libelle}
                  </BadgeStatut>{" "}
                  — {t("enregistré le", "recorded on")}{" "}
                  {formaterDateHeure(f.cree_le, undefined, langue)} {t("par", "by")} {f.auteur.nom}
                  {f.decision?.motif ? ` ${t("; motif :", "; reason:")} ${f.decision.motif}` : ""}
                </li>
              ))}
            </ol>
          ) : (
            <p>{historique.message}</p>
          )}
        </Carte>
      ) : null}

      {faits.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t("Aucun fait dans ce dossier.", "No facts in this file.")}
          icone="trombone"
        >
          <p>
            {t(
              "Ajoutez les faits datés et sourcés connus du client : effectif, actionnariat, marchés…",
              "Add the dated, sourced facts known about the client: headcount, shareholding, markets…",
            )}
          </p>
        </EtatVide>
      ) : (
        grouperParCategorie(faits.donnees.elements, langue).map((g) => (
          <Carte key={g.categorie} titre={g.libelle}>
            <Tableau
              legende={`${t("Faits", "Facts")}${t(" : ", ": ")}${g.libelle}`}
              lignes={g.faits}
              cleLigne={(f) => f.id}
              colonnes={[
                {
                  cle: "cle",
                  entete: t("Fait", "Fact"),
                  rendu: (f) => (
                    <Link href={`/dossiers/${id}/faits?fait=${f.id}`} className="mp-lien-ligne">
                      {f.cle}
                    </Link>
                  ),
                },
                {
                  cle: "valeur",
                  entete: t("Valeur", "Value"),
                  rendu: (f) => formaterValeurFait(f.valeur, langue),
                },
                {
                  cle: "date_effet",
                  entete: t("Date d'effet", "Effective date"),
                  rendu: (f) => formaterDate(f.date_effet, "UTC", langue),
                },
                {
                  cle: "source",
                  entete: "Source",
                  rendu: (f) => `${formaterSource(f.source, langue)} (${f.fiabilite})`,
                },
                {
                  cle: "statut",
                  entete: t("Statut", "Status"),
                  rendu: (f) => (
                    <BadgeStatut tonalite={statutFait(f.statut, langue).tonalite}>
                      {statutFait(f.statut, langue).libelle}
                    </BadgeStatut>
                  ),
                },
                {
                  cle: "actions",
                  entete: "Actions",
                  rendu: (f) =>
                    peutEcrire && (f.statut === "propose" || f.statut === "confirme") ? (
                      <ActionsFait clientId={id} fait={f} utilisateurId={utilisateur.id} />
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </Carte>
        ))
      )}
    </div>
  );
}
