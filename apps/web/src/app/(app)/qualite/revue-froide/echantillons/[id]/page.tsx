import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "../../../../../../components/qualite/froide.css";
import "../../../../../../components/qualite/qualite.css";
import { FroideConstats } from "../../../../../../components/qualite/FroideConstats";
import { FroideDossier } from "../../../../../../components/qualite/FroideDossier";
import { FroideGrille } from "../../../../../../components/qualite/FroideGrille";
import { FroideResultat } from "../../../../../../components/qualite/FroideResultat";
import { FroideTerminer } from "../../../../../../components/qualite/FroideTerminer";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import {
  cheminDossier,
  cheminEchantillon,
  droitsQualiteFroide,
  estUuid,
  HREF_REVUE_FROIDE,
  hrefCampagne,
  hrefEchantillon,
  libelleStatutEchantillon,
  tonaliteStatutEchantillon,
  type DossierRevue,
  type VueEchantillon,
} from "../../../../../../lib/qualite-froide";
import { exigerAccesFroide } from "../../../../../../lib/qualite-froide-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Revue à froid d'une mission", "Cold review of an engagement") };
}

/**
 * Revue d'une mission tirée : dossier en lecture seule, grille de huit critères, constats,
 * résultat du moteur et fin de la revue. Lecture seule si la revue est terminée ou si
 * l'utilisateur n'est pas le relecteur affecté (`peut_ecrire` vient de l'API).
 */
export default async function PageEchantillonFroid({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await exigerAccesFroide();
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const droits = droitsQualiteFroide(session.utilisateur.roles);
  const { id } = await params;
  if (!estUuid(id)) notFound();
  const [r, dossier] = await Promise.all([
    chargerServeur<VueEchantillon>(cheminEchantillon(id)),
    chargerServeur<DossierRevue>(cheminDossier(id)),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Revue à froid", "Cold review")}
          retour={{ href: HREF_REVUE_FROIDE, libelle: t("Revue à froid", "Cold review") }}
        />
        <EtatErreur
          titre={t("La revue n'a pas pu être chargée.", "The review could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefEchantillon(id)}
        />
      </div>
    );
  }
  const { echantillon: e, grille, resultat } = r.donnees;
  const terminee = e.statut === "terminee";
  const modifiable = r.donnees.peut_ecrire && !terminee;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={e.mission.mission_intitule}
        soustitre={t(
          `Client : ${e.mission.client_nom} · campagne ${e.campagne.intitule} · relecteur : ${e.relecteur?.nom ?? "non affecté"}`,
          `Client: ${e.mission.client_nom} · campaign ${e.campagne.intitule} · reviewer: ${e.relecteur?.nom ?? "not assigned"}`,
        )}
        retour={
          droits.gerer
            ? { href: hrefCampagne(e.campagne.id), libelle: t("Campagne", "Campaign") }
            : { href: HREF_REVUE_FROIDE, libelle: t("Revue à froid", "Cold review") }
        }
        badges={
          <BadgeStatut tonalite={tonaliteStatutEchantillon(e.statut)}>
            {libelleStatutEchantillon(e.statut, langue)}
          </BadgeStatut>
        }
      />

      {terminee ? (
        <Alerte
          tonalite="info"
          titre={t("Revue terminée et figée", "Review completed and frozen")}
          annonce="aucune"
        >
          <p>
            {t(
              `Terminée le ${formaterDate(e.terminee_le, "UTC", langue)}. Les notes, les constats et la synthèse ne se modifient plus.`,
              `Completed on ${formaterDate(e.terminee_le, "UTC", langue)}. Scores, findings and summary can no longer be edited.`,
            )}
          </p>
        </Alerte>
      ) : !r.donnees.peut_ecrire ? (
        <Alerte tonalite="info" titre={t("Lecture seule", "Read only")} annonce="aucune">
          <p>
            {t(
              "Seul le relecteur indépendant affecté à cette revue peut la remplir.",
              "Only the independent reviewer assigned to this review can fill it in.",
            )}
          </p>
        </Alerte>
      ) : null}

      <Carte titre={t("Dossier de la mission", "Engagement file")}>
        {dossier.ok ? (
          <FroideDossier dossier={dossier.donnees} />
        ) : (
          <EtatErreur
            titre={t(
              "Le dossier de la mission n'a pas pu être chargé.",
              "The engagement file could not be loaded.",
            )}
            message={dossier.message}
            hrefReessayer={hrefEchantillon(id)}
          />
        )}
      </Carte>

      <section aria-labelledby="titre-grille" className="mp-froide__pile">
        <h2 id="titre-grille" className="mp-section__titre">
          {t(
            `Grille de revue (version ${grille.version})`,
            `Review grid (version ${grille.version})`,
          )}
        </h2>
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "Notez chaque critère de 1 (insuffisant) à 5 (exemplaire), ou déclarez-le sans objet en justifiant. Chaque critère s'enregistre séparément.",
            "Score each criterion from 1 (insufficient) to 5 (exemplary), or mark it not applicable with a justification. Each criterion is saved separately.",
          )}
        </p>
        <FroideGrille
          echantillonId={e.id}
          criteres={grille.criteres}
          evaluations={r.donnees.evaluations}
          modifiable={modifiable}
        />
      </section>

      <Carte titre={t("Constats", "Findings")}>
        <FroideConstats
          echantillonId={e.id}
          constats={r.donnees.constats}
          modifiable={modifiable}
        />
      </Carte>

      <Carte
        titre={
          terminee
            ? t("Résultat de la revue", "Review result")
            : t("Résultat provisoire", "Provisional result")
        }
      >
        <FroideResultat resultat={resultat} definitif={terminee} />
        {terminee && e.synthese ? (
          <div className="mp-froide__pile">
            <h3 className="mp-qualite__sous-titre">
              {t("Synthèse du relecteur", "Reviewer summary")}
            </h3>
            <p>{e.synthese}</p>
          </div>
        ) : null}
      </Carte>

      {modifiable ? (
        <Carte titre={t("Terminer la revue", "Complete the review")}>
          <FroideTerminer echantillonId={e.id} />
        </Carte>
      ) : null}
    </div>
  );
}
