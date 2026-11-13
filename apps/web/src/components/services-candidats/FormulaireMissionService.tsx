"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useRafraichir } from "../formulaires/useRafraichir";
import { Alerte } from "../ui/Alerte";
import { Bouton, classesBouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select, type OptionSelect } from "../ui/Select";
import { api, messageErreur } from "../../lib/api";
import { messageMethodes } from "../../lib/methodes";
import type { ChampMission, Mission } from "../../lib/missions";
import {
  cheminMission,
  corpsLiaisonMethode,
  intituleParDefaut,
  SAISIE_MISSION_SERVICE_VIDE,
  validerMissionService,
  type SaisieMissionService,
  type ServiceCandidat,
} from "../../lib/services-candidats";

export interface FormulaireMissionServiceProps {
  service: ServiceCandidat;
  clients: readonly OptionSelect[];
  /** Client préchoisi (lien `?client=`) : ignoré s'il n'est pas dans `clients`. */
  clientInitial?: string | null;
}

interface Partielle {
  missionId: string;
  message: string;
}

/**
 * Crée une mission depuis un service : POST /api/missions (type de mission du service) puis
 * PUT /api/missions/:id/methode (version publiée de la méthode). Si la liaison échoue, la
 * mission existe déjà : on affiche son lien et on propose de relancer la seule liaison.
 */
export function FormulaireMissionService({
  service,
  clients,
  clientInitial = null,
}: FormulaireMissionServiceProps) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const f = useFormulaire<ChampMission>();
  const [s, setS] = useState<SaisieMissionService>(() => {
    const choisi = clients.find((c) => c.valeur === clientInitial);
    return {
      ...SAISIE_MISSION_SERVICE_VIDE,
      client_id: choisi ? choisi.valeur : "",
      intitule: choisi ? intituleParDefaut(service, choisi.libelle) : service.libelle,
    };
  });
  const [intituleLibre, setIntituleLibre] = useState(false);
  const [partielle, setPartielle] = useState<Partielle | null>(null);
  const [reliaison, setReliaison] = useState(false);
  const liaison = corpsLiaisonMethode(service);

  const choisirClient = (id: string) =>
    setS((x) => {
      const libelle = clients.find((c) => c.valeur === id)?.libelle ?? "";
      return {
        ...x,
        client_id: id,
        intitule: intituleLibre ? x.intitule : intituleParDefaut(service, libelle),
      };
    });

  async function lier(missionId: string): Promise<string | null> {
    if (!liaison)
      return t(
        "Aucune méthode publiée à lier à la mission.",
        "No published method to link to the engagement.",
      );
    try {
      await api.put(`/api/missions/${encodeURIComponent(missionId)}/methode`, liaison);
      return null;
    } catch (e) {
      return messageMethodes(e, langue) ?? messageErreur(e, langue);
    }
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setPartielle(null);
    await f.envoyer(
      validerMissionService(s, service, langue),
      async (charge) => {
        const mission = await api.post<Mission>("/api/missions", charge);
        return { mission, erreurLiaison: await lier(mission.id) };
      },
      {
        rafraichir: false,
        apres: ({ mission, erreurLiaison }) => {
          if (erreurLiaison) {
            setPartielle({ missionId: mission.id, message: erreurLiaison });
            return;
          }
          router.push(cheminMission(mission.id));
          rafraichir();
        },
      },
    );
  }

  async function relancer() {
    if (!partielle) return;
    setReliaison(true);
    const erreur = await lier(partielle.missionId);
    setReliaison(false);
    if (erreur) setPartielle({ ...partielle, message: erreur });
    else {
      router.push(cheminMission(partielle.missionId));
      rafraichir();
    }
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Création impossible", "Creation failed")}
      />
      {partielle ? (
        <Alerte
          tonalite="attention"
          titre={t("Mission créée, méthode non liée", "Engagement created, method not linked")}
          annonce="alert"
        >
          <p>
            {t(
              "La mission a été créée, mais la méthode du standard n'a pas pu y être liée :",
              "The engagement was created, but the standard's method could not be linked to it:",
            )}{" "}
            {partielle.message}
          </p>
          <p>
            <Link href={cheminMission(partielle.missionId)}>
              {t("Ouvrir la mission créée", "Open the created engagement")}
            </Link>
          </p>
          <Bouton
            variante="secondaire"
            chargement={reliaison}
            texteChargement={t("Liaison…", "Linking…")}
            onClick={relancer}
          >
            {t("Réessayer la liaison de la méthode", "Retry linking the method")}
          </Bouton>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs">
        <Select
          libelle={t("Client", "Client")}
          name="client_id"
          required
          options={clients}
          invite={
            clients.length
              ? t("Choisir le client…", "Choose the client…")
              : t("Aucun client actif disponible", "No active client available")
          }
          value={s.client_id}
          onChange={(e) => choisirClient(e.target.value)}
          erreur={f.erreurs.client_id}
        />
        <Champ
          libelle={t("Intitulé de la mission", "Engagement title")}
          name="intitule"
          required
          maxLength={200}
          value={s.intitule}
          onChange={(e) => {
            setIntituleLibre(true);
            setS((x) => ({ ...x, intitule: e.target.value }));
          }}
          erreur={f.erreurs.intitule}
        />
        <Champ
          libelle={t("Date de début", "Start date")}
          name="date_debut"
          type="date"
          value={s.date_debut}
          onChange={(e) => setS((x) => ({ ...x, date_debut: e.target.value }))}
          erreur={f.erreurs.date_debut}
          aide={t("Facultatif.", "Optional.")}
        />
        <Champ
          libelle={t("Date de fin", "End date")}
          name="date_fin"
          type="date"
          value={s.date_fin}
          onChange={(e) => setS((x) => ({ ...x, date_fin: e.target.value }))}
          erreur={f.erreurs.date_fin}
          aide={t("Facultatif.", "Optional.")}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="plus"
          chargement={f.enCours}
          texteChargement={t("Création…", "Creating…")}
          disabled={partielle !== null}
        >
          {t(
            `Créer une mission « ${service.libelle} »`,
            `Create an engagement "${service.libelle}"`,
          )}
        </Bouton>
        {partielle ? (
          <Link href={cheminMission(partielle.missionId)} className={classesBouton("discret")}>
            {t("Voir la mission", "View the engagement")}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
